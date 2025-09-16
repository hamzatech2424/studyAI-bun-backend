import { successResponseHelper, errorResponseHelper } from '../utils/response';
import { documentsTable, docChunksTable } from '../modals/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
// Import pdf-parse dynamically to avoid debug mode issues
const pdfParse = require("pdf-parse");
import { chunkText, cleanText } from '../helper/documnetHelper';
import OpenAI from "openai";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
}

const client = postgres(connectionString, { prepare: false });
const db = drizzle(client);

const uploadDocument = async (c: any) => {
    try {
        const form = await c.req.formData();
        const file = form.get("file") as File;
        const userId = form.get("userId") as string | null;

        if (!file) {
            return c.json({ error: "No file uploaded" }, 400);
        }

        // read file buffer
        const buf = Buffer.from(await file.arrayBuffer());

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

        return c.json({ documentId: doc?.id, doc, message: "Upload successful" });
    } catch (error) {
        console.log("Error in uploadDocument:", error);
        return c.json({ error: "Upload failed" }, 500);
    }
};




const queryOnDocument = async (c: any) => {
    try {
        const { documentId, question, k = 5 } = await c.req.json();

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
      where document_id = '${documentId}'
      order by embedding <-> '${JSON.stringify(qEmbedding)}'
      limit ${k};
    `);

        // 3. Build context
        const context = rows
            .map((r, i) => `Chunk ${i + 1}: ${r.text}`)
            .join("\n\n");


        const prompt = `
        You are a helpful assistant. 
        Use the provided context from the book to answer the user's question.
        
        - If the answer is explicitly in the text, return it clearly.
        - If the answer can be inferred (like counting stories, summarizing, or combining information), do so.
        - If the context is insufficient, say "I don't know".
        
        Context:
        ${context}
        
        Question: ${question}
        Answer:
        `;

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

        return c.json({ answer, sources: rows });
    } catch (error) {
        console.log("Error in queryOnDocument:", error);
        return errorResponseHelper(c, error);
    }
}

export { uploadDocument, queryOnDocument };