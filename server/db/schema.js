import { pgTable, serial, text, boolean, timestamp, uuid, integer } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").unique().notNull(),
  password: text("password").notNull(),
  role: text("role").default("user").notNull(), // 'admin' or 'user'
  hasAccess: boolean("has_access").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

export const parties = pgTable("parties", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  hostId: integer("host_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  streamKey: text("stream_key").notNull(), // Unique key for MediaMTX WHIP/HLS route
  createdAt: timestamp("created_at").defaultNow().notNull()
});
