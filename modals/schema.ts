import { pgTable, integer, varchar, timestamp, json, uniqueIndex, uuid, text, jsonb, vector } from "drizzle-orm/pg-core";


export const usersTable = pgTable("users", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    clerk_id: varchar("clerk_id", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    full_name: varchar("full_name", { length: 255 }),
    raw: json("raw").$type<any>(), // whole clerk user object
    created_at: timestamp("created_at").defaultNow(),
}, (table) => {
    return {
        clerk_id_idx: uniqueIndex("users_clerk_id_unique").on(table.clerk_id),
    };
});

export const documentsTable = pgTable("documents", {
    id: uuid("id").defaultRandom().primaryKey(),
    // userId: uuid("user_id"),
    userId: text("user_id"), // for now just a text field, can store any key/string
    filePath: text("file_path"),
    fileName: text("file_name"),
    createdAt: timestamp("created_at").defaultNow(),
});

export const docChunksTable = pgTable("doc_chunks", {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id").references(() => documentsTable.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index"),
    text: text("text"),
    metadata: jsonb("metadata"),
    embedding: vector("embedding", { dimensions: 1536 }), // match embedding model dimension
    createdAt: timestamp("created_at").defaultNow(),
});
