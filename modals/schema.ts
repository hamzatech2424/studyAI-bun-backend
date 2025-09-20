import { pgTable, integer, varchar, timestamp, json, uniqueIndex, uuid, text, jsonb, vector } from "drizzle-orm/pg-core";

// Users table
export const usersTable = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  clerk_id: varchar("clerk_id", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  last_name: varchar("last_name", { length: 255 }),
  first_name: varchar("first_name", { length: 255 }),
  raw: json("raw").$type<any>(), // whole clerk user object
  created_at: timestamp("created_at").defaultNow(),
}, (table) => ({
  clerk_id_idx: uniqueIndex("users_clerk_id_unique").on(table.clerk_id),
}));

// Documents table
export const documentsTable = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }), // link to user
  filePath: text("file_path"),
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Document chunks
export const docChunksTable = pgTable("doc_chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id").references(() => documentsTable.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index"),
  text: text("text"),
  metadata: jsonb("metadata"),
  embedding: vector("embedding", { dimensions: 1536 }),
  createdAt: timestamp("created_at").defaultNow(),
});

// Chats table linked to user
export const chatsTable = pgTable("chats", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }), // foreign key to users
  documentId: uuid("document_id").references(() => documentsTable.id, { onDelete: "set null" }),
  title: text("title"),
  lastMessage: text("last_message"),
  lastMessageType: varchar("last_message_type", { length: 20 }),
  lastMessageAt: timestamp("last_message_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Chat messages table
export const chatMessagesTable = pgTable("chat_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  chatId: uuid("chat_id").references(() => chatsTable.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 20 }).notNull(), // "user" or "ai"
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});
