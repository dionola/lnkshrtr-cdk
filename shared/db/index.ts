import * as schema from "./schema";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

// In tests, use standard pg over TCP. In production, use Neon HTTP (serverless-compatible).
function createDb(): NeonHttpDatabase<typeof schema> {
  if (process.env.NODE_ENV === "test") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle } = require("drizzle-orm/node-postgres");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("pg");
    return drizzle(
      new Pool({ connectionString: process.env.DATABASE_URL }),
      { schema }
    ) as unknown as NeonHttpDatabase<typeof schema>;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { neon } = require("@neondatabase/serverless");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require("drizzle-orm/neon-http");
  return drizzle(neon(process.env.DATABASE_URL!), { schema });
}

export const db = createDb();
export type DB = typeof db;
export * from "./schema";
