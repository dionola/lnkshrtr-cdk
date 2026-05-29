import { eq, and } from "drizzle-orm";
import { db, users, links } from "../../../shared/db";

export const publicRepository = {
  findUserByUsername: (username: string) =>
    db.select().from(users).where(eq(users.username, username)).limit(1).then((r) => r[0] ?? null),

  findPublicLinksByUsername: (username: string, type?: string) =>
    db
      .select({ links })
      .from(links)
      .innerJoin(users, eq(links.userId, users.id))
      .where(
        type
          ? and(eq(users.username, username), eq(links.isPublic, true), eq(links.isActive, true), eq(links.type, type))
          : and(eq(users.username, username), eq(links.isPublic, true), eq(links.isActive, true))
      )
      .then((r) => r.map((row) => row.links)),
};
