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
    // Create a more robust readable stream with proper state management
    const stream = new ReadableStream({
        async start(controller) {
            let streamState = {
                isClosed: false,
                isError: false,
                progress: 0,
                isProcessing: false
            };
            
            // Enhanced safe enqueue with better error handling
            const safeEnqueue = (data: string) => {
                // Check if controller is already closed or in error state
                if (streamState.isClosed || streamState.isError) {
                    console.log('⚠️ Stream already closed or in error state, skipping enqueue');
                    return false;
                }
                
                try {
                    // Simply try to enqueue - let the try/catch handle any errors
                    controller.enqueue(new TextEncoder().encode(data));
                    console.log(`📤 Successfully enqueued: ${data.substring(0, 100)}...`);
                    return true;
                } catch (error) {
                    console.error('❌ Failed to enqueue data:', error);
                    streamState.isClosed = true;
                    return false;
                }
            };

            // Enhanced safe close with state management
            const safeClose = () => {
                if (streamState.isClosed || streamState.isError) {
                    console.log('⚠️ Stream already closed or in error state, skipping close');
                    return;
                }
                
                try {
                    controller.close();
                    streamState.isClosed = true;
                    console.log('✅ Stream closed successfully');
                } catch (error) {
                    console.error('❌ Failed to close controller:', error);
                    streamState.isClosed = true;
                }
            };

            // Enhanced error handling
            const handleError = (error: any, message: string) => {
                console.error(`❌ ${message}:`, error);
                streamState.isError = true;
                
                const errorData = JSON.stringify({
                    success: false,
                    error: message,
                    details: error instanceof Error ? error.message : "Unknown error"
                });
                
                safeEnqueue(`data: ${errorData}\n\n`);
                safeClose();
            };

            // Helper function for progress messages
            const sendProgress = (message: string, progress?: number) => {
                const data = JSON.stringify({ message, progress });
                console.log(`📤 Sending progress: ${progress}% - ${message}`);
                return `data: ${data}\n\n`;
            };

            // Set up a timeout to handle long operations
            const timeoutId = setTimeout(() => {
                if (!streamState.isClosed && !streamState.isError) {
                    console.log('⏰ Upload timeout - closing stream gracefully');
                    streamState.isClosed = true;
                    safeClose();
                }
            }, 300000); // 5 minutes timeout

            try {
                // Progress 1: File received
                if (!safeEnqueue(sendProgress("File received, starting upload...", 10))) {
                    clearTimeout(timeoutId);
                    return;
                }

                const form = await c.req.formData();
                const file = form.get("file") as File;
                
                // Get user from authenticated context
                const clerkUser = c.get('clerkUser');
                if (!clerkUser) {
                    handleError(new Error("No user context"), "Unauthorized");
                    clearTimeout(timeoutId);
                    return;
                }

                const user = await db.select().from(usersTable)
                    .where(eq(usersTable.clerk_id, clerkUser.userId));

                if (!user || user.length === 0) {
                    handleError(new Error("User not found in database"), "User not found");
                    clearTimeout(timeoutId);
                    return;
                }

                if (!file) {
                    handleError(new Error("No file provided"), "No file uploaded");
                    clearTimeout(timeoutId);
                    return;
                }

                // Progress 2: Uploading to Supabase
                if (!safeEnqueue(sendProgress("Uploading file to storage...", 30))) {
                    clearTimeout(timeoutId);
                    return;
                }
                
                const buf = Buffer.from(await file.arrayBuffer());
                let fileUrl: string;
                
                try {
                    fileUrl = await fileUpload(file, buf);
                    streamState.progress = 50;
                    if (!safeEnqueue(sendProgress("File uploaded successfully", streamState.progress))) {
                        clearTimeout(timeoutId);
                        return;
                    }
                } catch (uploadError) {
                    handleError(uploadError, "Upload failed");
                    clearTimeout(timeoutId);
                    return;
                }

                // Progress 3: Parsing PDF
                if (!safeEnqueue(sendProgress("Parsing PDF content...", 60))) {
                    clearTimeout(timeoutId);
                    return;
                }
                
                const parsed = await pdfParse(buf);
                const text = cleanText(parsed.text || "");

                if (!text) {
                    handleError(new Error("No text content"), "Error: PDF contains no extractable text");
                    clearTimeout(timeoutId);
                    return;
                }

                // Progress 4: Creating document record
                if (!safeEnqueue(sendProgress("Creating document record...", 70))) {
                    clearTimeout(timeoutId);
                    return;
                }
                
                const [doc] = await db.insert(documentsTable).values({
                    userId: user[0]?.id ?? null,
                    filePath: file.name,
                    fileUrl: fileUrl as string,
                    fileName: file.name,
                }).returning();

                // Progress 5: Processing chunks
                if (!safeEnqueue(sendProgress("Processing document chunks...", 80))) {
                    clearTimeout(timeoutId);
                    return;
                }
                
                const chunks = chunkText(text, 1200, 200);

                // Progress 6: Creating embeddings
                if (!safeEnqueue(sendProgress("Creating AI embeddings...", 90))) {
                    clearTimeout(timeoutId);
                    return;
                }
                
                // Process chunks in batches to avoid overwhelming the stream
                const batchSize = 5;
                for (let i = 0; i < chunks.length; i += batchSize) {
                    // Check stream state before each batch
                    if (streamState.isClosed || streamState.isError) {
                        console.log('⚠️ Stream closed during chunk processing, stopping');
                        clearTimeout(timeoutId);
                        return;
                    }
                    
                    const batch = chunks.slice(i, i + batchSize);
                    
                    for (let j = 0; j < batch.length; j++) {
                        const chunk = batch[j];
                        const chunkIndex = i + j;
                        
                        try {
                            const resp = await openai.embeddings.create({
                                model: "text-embedding-3-small",
                                input: chunk || "",
                            });

                            const embedding = resp.data[0]?.embedding;
                            await db.insert(docChunksTable).values({
                                documentId: doc?.id,
                                chunkIndex: chunkIndex,
                                text: chunk,
                                metadata: { source: file.name },
                                embedding,
                            });

                            // Update progress for each chunk
                            const chunkProgress = 90 + Math.round(((chunkIndex + 1) / chunks.length) * 8);
                            if (!safeEnqueue(sendProgress(`Embedding chunk ${chunkIndex + 1}/${chunks.length}`, chunkProgress))) {
                                clearTimeout(timeoutId);
                                return;
                            }
                        } catch (err) {
                            console.error("Embedding error for chunk", chunkIndex, err);
                            // Continue with other chunks even if one fails
                        }
                    }
                    
                    // Small delay between batches to prevent overwhelming
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                // Progress 7: Creating chat
                if (!safeEnqueue(sendProgress("Creating chat session...", 95))) {
                    clearTimeout(timeoutId);
                    return;
                }
                
                let chatTitle = file.name;
                try {
                    const titleResponse = await openai.chat.completions.create({
                        model: "gpt-3.5-turbo",
                        messages: [
                            {
                                role: "system",
                                content: "Generate a short, descriptive title (max 5 words) for this document."
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
                }

                const [chat] = await db.insert(chatsTable).values({
                    userId: user[0]?.id ?? null,
                    documentId: doc?.id ?? null,
                    title: chatTitle,
                }).returning();

                const [aiMessage] = await db.insert(chatMessagesTable).values({
                    chatId: chat?.id ?? null,
                    type: "ai",
                    content: "How can I assist you?",
                }).returning();

                await db.update(chatsTable)
                .set({
                    lastMessage: aiMessage?.content,
                    lastMessageType: aiMessage?.type,
                    lastMessageAt: aiMessage?.createdAt || new Date(),
                })
                .where(eq(chatsTable.id, chat?.id!));

                // Progress 8: Complete
                if (!safeEnqueue(sendProgress("Upload complete!", 100))) {
                    clearTimeout(timeoutId);
                    return;
                }
                
                // Send final result
                const result = {
                    success: true,
                    chat: {
                        ...chat,
                        document: doc,
                        messages: aiMessage,
                    },
                    message: "Chat Created successfully"
                };
                
                if (!safeEnqueue(`data: ${JSON.stringify(result)}\n\n`)) {
                    clearTimeout(timeoutId);
                    return;
                }
                
                // Clear timeout and final close
                clearTimeout(timeoutId);
                safeClose();

            } catch (error) {
                clearTimeout(timeoutId);
                handleError(error, "Unexpected error during upload");
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'X-Accel-Buffering': 'no', // Disable nginx buffering
            'Keep-Alive': 'timeout=300, max=1000' // Extend timeout
        }
    });
};


export { createChat, sendChatMessage, getAllChats, getSingleChat, uploadDocumentWithProgress };