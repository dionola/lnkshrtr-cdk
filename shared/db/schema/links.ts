import { pgTable, text, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { users } from "./users";

export const links = pgTable(
  "links",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    shortCode: text("shortCode").notNull().unique(),
    originalUrl: text("originalUrl").notNull(),
    title: text("title"),
    isPublic: boolean("isPublic").notNull().default(true),
    isActive: boolean("isActive").notNull().default(true),
    isPasswordProtected: boolean("isPasswordProtected").notNull().default(false),
    password: text("password"),
    userId: text("userId").references(() => users.id, { onDelete: "set null" }),
    type: text("type").notNull().default("link"),
    visits: integer("visits").notNull().default(0),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index("links_user_id_idx").on(t.userId),
    index("links_short_code_idx").on(t.shortCode),
  ]
);

export type Link = typeof links.$inferSelect;
export type NewLink = typeof links.$inferInsert;
