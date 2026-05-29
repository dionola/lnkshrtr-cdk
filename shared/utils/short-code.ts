import { eq } from "drizzle-orm";
import { db, links } from "../db";
import { AppError } from "./errors";

const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 10;

function randomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => CHARS[b % CHARS.length])
    .join("");
}

export async function generateUniqueShortCode(): Promise<string> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const code = randomCode();
    const existing = await db
      .select({ id: links.id })
      .from(links)
      .where(eq(links.shortCode, code))
      .limit(1);
    if (existing.length === 0) return code;
  }
  throw new AppError(500, "INTERNAL_ERROR", "Failed to generate unique short code");
}
