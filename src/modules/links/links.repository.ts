import { eq, and, desc } from "drizzle-orm";
import { db, links, type NewLink } from "../../../shared/db";

export const linksRepository = {
  findByShortCode: (shortCode: string) =>
    db.select().from(links).where(eq(links.shortCode, shortCode)).limit(1).then((r) => r[0] ?? null),

  findById: (id: string) =>
    db.select().from(links).where(eq(links.id, id)).limit(1).then((r) => r[0] ?? null),

  findByUser: (userId: string, type?: string) =>
    db
      .select()
      .from(links)
      .where(type ? and(eq(links.userId, userId), eq(links.type, type)) : eq(links.userId, userId))
      .orderBy(desc(links.createdAt)),

  create: (data: NewLink) =>
    db.insert(links).values(data).returning().then((r) => r[0]),

  update: (id: string, data: Partial<NewLink>) =>
    db.update(links).set(data).where(eq(links.id, id)).returning().then((r) => r[0]),

  delete: (id: string) =>
    db.delete(links).where(eq(links.id, id)),
};
