import { eq } from "drizzle-orm";
import { db, users, type NewUser } from "../../../shared/db";

export const authRepository = {
  findByEmail: (email: string) =>
    db.select().from(users).where(eq(users.email, email)).limit(1).then((r) => r[0] ?? null),

  findById: (id: string) =>
    db.select().from(users).where(eq(users.id, id)).limit(1).then((r) => r[0] ?? null),

  findByUsername: (username: string) =>
    db.select().from(users).where(eq(users.username, username)).limit(1).then((r) => r[0] ?? null),

  create: (data: NewUser) =>
    db.insert(users).values(data).returning().then((r) => r[0]),
};
