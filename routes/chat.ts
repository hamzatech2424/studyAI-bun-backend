import { successResponseHelper, errorResponseHelper } from '../utils/response';
import { documentsTable, docChunksTable, usersTable, chatsTable, chatMessagesTable } from '../modals/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, asc, desc } from 'drizzle-orm';
import postgres from 'postgres';
// Import pdf-parse dynamically to avoid debug mode issues
const pdfParse = require("pdf-parse");
import { chunkText, cleanText } from '../helper/documnetHelper';
import OpenAI from "openai";
import { fileUpload } from '../helper/supabase';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});


const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
}

const client = postgres(connectionString, { prepare: false });
const db = drizzle(client);

const createChat = async (c: any) => {
    try {

        const clerkUser = c.get('clerkUser');
        if (!clerkUser) {
            return c.json({
                success: false,
                error: {
                    code: 401,
                    message: "Unauthorized",
                    description: "Authentication required"
                }
            }, 401);
        }

        // Find user in database using clerk ID
        const user = await db.select().from(usersTable)
            .where(eq(usersTable.clerk_id, clerkUser.userId));

        if (!user || user.length === 0) {
            return c.json({
                success: false,
                error: {
                    code: 404,
                    message: "User not found",
                    description: "User does not exist in database"
                }
            }, 404);
        }

        const form = await c.req.formData();
        const file = form.get("file") as File;
        const userId = user[0]?.id ?? null;

        if (!file) {
            return c.json({ error: "No file uploaded" }, 400);
        }

        // read file buffer
        const buf = Buffer.from(await file.arrayBuffer());

        let fileUrl: string;
        try {
            fileUrl = await fileUpload(file, buf);
        } catch (uploadError) {
            console.error("File upload error:", uploadError);
            return c.json({
                success: false,
                error: "File upload failed",
                message: uploadError instanceof Error ? uploadError.message : "Unknown upload error"
            }, 500);
        }

        // parse PDF
        const parsed = await pdfParse(buf);
        const text = cleanText(parsed.text || "");

        if (!text) {
            return c.json({ error: "PDF contains no extractable text" }, 400);
        }

        // insert document metadata
        const [doc] = await db
          .insert(documentsTable)
          .values({
            userId: userId ?? null,
            filePath: file.name,
                fileUrl: fileUrl as string,
            fileName: file.name,
          })
          .returning();
      
        // split into chunks
        const chunks = chunkText(text, 1200, 200);
     
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];

            try {
                // ✅ New embeddings call (2024 SDK)
                const resp = await openai.embeddings.create({
                model: "text-embedding-3-small",
                    input: chunk || "",
            });

                const embedding = resp.data[0]?.embedding;

                // insert chunk + vector
            await db.insert(docChunksTable).values({
                documentId: doc?.id,
                chunkIndex: i,
                text: chunk,
                metadata: { source: file.name },
                    embedding, // Drizzle + pgvector handles this fine
                });
            } catch (err) {
                console.error("Embedding error for chunk", i, err);
                // continue gracefully
            }
        }

        // Generate a descriptive title from the first chunk of text
        let chatTitle = file.name;
        try {
            const titleResponse = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    {
                        role: "system",
                        content: "Generate a short, descriptive title (max 5 words) for this document based on its content."
                    },
                    {
                        role: "user",
                        content: chunks[0] || file.name
                    }
                ],
                temperature: 0.3,
                max_tokens: 20
            });
            chatTitle = titleResponse.choices[0]?.message?.content || file.name;
        } catch (err) {
            console.error("Error generating chat title:", err);
            // Fallback to filename if title generation fails
        }

        const [chat] = await db.insert(chatsTable)
            .values({
                userId: userId ?? null,
                documentId: doc?.id,
                title: chatTitle,
            })
            .returning({ id: chatsTable.id, userId: chatsTable.userId, documentId: chatsTable.documentId, title: chatsTable.title });

        // 2️⃣ Insert initial AI message
        const [chatMessage] = await db.insert(chatMessagesTable)
            .values({
                chatId: chat?.id,
                type: "ai",
                content: "How can I assist you?",
            })
            .returning({
                content: chatMessagesTable.content,
                type: chatMessagesTable.type,
                createdAt: chatMessagesTable.createdAt,
            });

        // 3️⃣ Update chat lastMessage
        await db.update(chatsTable)
            .set({
                lastMessage: chatMessage?.content,
                lastMessageType: chatMessage?.type,
                lastMessageAt: chatMessage?.createdAt || new Date(),
            })
            .where(eq(chatsTable.id, chat?.id!));

        // Get all messages for this chat
        const messages = await db.select({
            id: chatMessagesTable.id,
            content: chatMessagesTable.content,
            type: chatMessagesTable.type,
            createdAt: chatMessagesTable.createdAt,
            metadata: chatMessagesTable.metadata
        })
            .from(chatMessagesTable)
            .where(eq(chatMessagesTable.chatId, chat?.id!))
            .orderBy(asc(chatMessagesTable.createdAt));

        return c.json({
            chat: {
                ...chat,
                document: doc,
                messages: messages,
            },
            message: "Chat Created successfully"
        });
    } catch (error) {
        console.log("Error in uploadDocument:", error);
        return c.json({ error: "Upload failed" }, 500);
    }
};


const sendChatMessage = async (c: any) => {
    try {
        const { chatId: requestChatId } = await c.req.param();
        const { question, k = 5 } = await c.req.json();

        const chat = await db.select().from(chatsTable)
            .where(eq(chatsTable.id, requestChatId));

        if (!chat || chat.length === 0) {
            return errorResponseHelper(c, "Chat not found");
        }

        const [userMessage] = await db.insert(chatMessagesTable)
            .values({
                chatId: requestChatId,
                type: "user",
                content: question,
            })
            .returning();

        let { chatId: userMessageChatId, ...userMessageWithoutChatId } = userMessage || {};

        // 1. Embed question
        const embeddingResp = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: question,
        });
        const qEmbedding = embeddingResp.data[0]?.embedding;

        // 2. Vector search (raw SQL because drizzle doesn’t expose `<->`)
        const rows = await db.execute<{
            text: string;
            metadata: any;
        }>(`
      select text, metadata
      from doc_chunks
      where document_id = '${chat[0]?.documentId ?? null}'
      order by embedding <-> '${JSON.stringify(qEmbedding)}'
      limit ${k};
    `);

        // 3. Build context
        const context = rows
            .map((r, i) => `Chunk ${i + 1}: ${r.text}`)
            .join("\n\n");


        const prompt = `
            You are an expert document analysis assistant. Your job is to provide helpful, accurate, and comprehensive answers based on the provided context.
            
            CONTEXT PROVIDED:
            ${context}
            
            USER QUESTION: ${question}
            
            RESPONSE GUIDELINES:
            1. **Direct Answers**: If the information is explicitly stated in the context, provide a clear, direct answer with specific details.
            
            2. **Inference & Analysis**: If you can reasonably infer the answer by:
               - Analyzing patterns in the text
               - Combining multiple pieces of information
               - Drawing logical conclusions
               - Counting or calculating based on the text
               Then provide that analysis with confidence.
            
            3. **Summarization**: If asked for summaries, overviews, or main points, synthesize the key information from the context.
            
            4. **Exploration**: If the user asks exploratory questions (like "What themes are present?" or "What can you tell me about...?"), provide insightful analysis based on the available context.
            
            5. **Follow-up Questions**: If the user asks follow-up questions or requests clarification, use the context to provide relevant information.
            
            6. **Only say "I don't know"** if:
               - The question is completely unrelated to the document
               - The context provides absolutely no relevant information
               - The question requires information not present in the text
            
            TONE: Be helpful, informative, and confident when you have relevant information. Use the context actively rather than passively.
            
            ANSWER:`;

        // 4. Call OpenAI Chat
        const chatResp = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: "You are a book analysis assistant." },
                { role: "user", content: prompt },
            ],
            temperature: 0.2, // factual answers
        });

        const answer = chatResp.choices?.[0]?.message?.content ?? "I don't know";

        const [aiMessage] = await db.insert(chatMessagesTable)
            .values({
                chatId: requestChatId,
                type: "ai",
                content: answer,
            })
            .returning();

        let { chatId: aiMessageChatId, ...aiMessageWithoutChatId } = aiMessage || {};

        await db.update(chatsTable)
            .set({
                lastMessage: answer,
                lastMessageType: "ai",
                lastMessageAt: aiMessage?.createdAt || new Date(),
            })
            .where(eq(chatsTable.id, requestChatId));

        return successResponseHelper(c, { chat: { ...chat[0], newMessages: { userMessage: userMessageWithoutChatId, aiMessage: aiMessageWithoutChatId } }, answer, sources: rows });
    } catch (error) {
        console.log("Error in sendChatMessage:", error);
        return errorResponseHelper(c, error);
    }
}

const getAllChats = async (c: any) => {
    try {
        const clerkUser = c.get('clerkUser');
        if (!clerkUser) {
            return c.json({ success: false, error: "Unauthorized" }, 401);
        }

        const user = await db.select().from(usersTable)
            .where(eq(usersTable.clerk_id, clerkUser.userId));

        if (!user || user.length === 0) {
            return c.json({ success: false, error: "User not found" }, 404);
        }

        const chats = await db.select().from(chatsTable)
            .where(eq(chatsTable.userId, user[0]?.id!));

        return successResponseHelper(c, { chats });
    }
    catch (error) {
        console.log("Error in getAllChats:", error);
        return errorResponseHelper(c, error);
    }
}

const getSingleChat = async (c: any) => {
    try {
        const chatId = await c.req.param('chatId');

        const chat = await db.select().from(chatsTable)
            .where(eq(chatsTable.id, chatId));

        if (!chat || chat.length === 0) {
            return errorResponseHelper(c, "Chat not found");
        }

        const document = await db.select().from(documentsTable)
            .where(eq(documentsTable.id, chat[0]?.documentId!));

        const messages = await db.select().from(chatMessagesTable)
            .where(eq(chatMessagesTable.chatId, chatId))
            .orderBy(desc(chatMessagesTable.createdAt));

        return successResponseHelper(c, { chat: { ...chat[0], messages: messages, document: document[0] } });
    }
    catch (error) {
        console.log("Error in getSingleChat:", error);
        return errorResponseHelper(c, error);
    }
}


const uploadDocumentWithProgress = async (c: any) => {
    // state vars must be defined outside `start` so both start & cancel can access
    let isClosed = false;
    let isError = false;
    let hasFinalEvent = false;
  
    const stream = new ReadableStream({
      async start(controller) {
        const safeEnqueue = (data: string) => {
          if (isClosed || isError || hasFinalEvent) {
            console.log("⚠️ Skipping enqueue: stream already closed/error/final");
            return false;
          }
          try {
            controller.enqueue(new TextEncoder().encode(data));
            return true;
          } catch (err) {
            console.error("❌ Enqueue failed:", err);
            isClosed = true;
            return false;
          }
        };
  
        const closeStream = () => {
          if (isClosed) return;
          try {
            controller.close();
            isClosed = true;
            console.log("✅ Stream closed");
          } catch (err) {
            console.error("❌ Close failed:", err);
          }
        };
  
        const sendFinal = (payload: any) => {
          if (hasFinalEvent) return;
          hasFinalEvent = true;
          if (safeEnqueue(`data: ${JSON.stringify(payload)}\n\n`)) {
            closeStream();
          } else {
            closeStream();
          }
        };
  
        const handleError = (error: any, message: string) => {
          console.error("❌", message, error);
          if (isError || hasFinalEvent) return;
          isError = true;
          sendFinal({
            success: false,
            error: message,
            details: error instanceof Error ? error.message : "Unknown error",
          });
        };
  
        const sendProgress = (message: string, progress?: number) => {
          return `data: ${JSON.stringify({ message, progress })}\n\n`;
        };
  
        try {
          // 1. File received
          safeEnqueue(sendProgress("File received, starting upload...", 10));
  
          const form = await c.req.formData();
          const file = form.get("file") as File;
  
          const clerkUser = c.get("clerkUser");
          if (!clerkUser) return handleError(new Error("No user"), "Unauthorized");
  
          const user = await db
            .select()
            .from(usersTable)
            .where(eq(usersTable.clerk_id, clerkUser.userId));
  
          if (!user?.length)
            return handleError(new Error("User missing"), "User not found");
          if (!file)
            return handleError(new Error("Missing file"), "No file uploaded");
  
          // 2. Upload to Supabase
          safeEnqueue(sendProgress("Uploading file to storage...", 30));
  
          const buf = Buffer.from(await file.arrayBuffer());
          let fileUrl: string;
          try {
            fileUrl = await fileUpload(file, buf);
            safeEnqueue(sendProgress("File uploaded successfully", 50));
          } catch (err) {
            return handleError(err, "Upload failed");
          }
  
          // ... (same parsing, chunking, embeddings, chat creation code)
  
          // Final success
          sendFinal({
            success: true,
            message: "Upload complete!",
            // attach extra data...
          });
        } catch (err) {
          handleError(err, "Unexpected error during upload");
        }
      },
  
      cancel() {
        console.log("⚠️ Client disconnected, closing stream");
        isClosed = true;
      },
    });
  
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "X-Accel-Buffering": "no",
      },
    });
  };

export { createChat, sendChatMessage, getAllChats, getSingleChat, uploadDocumentWithProgress };