import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  UPSTASH_REDIS_URL: z.string().optional(),
  UPSTASH_REDIS_TOKEN: z.string().optional(),
});

export const env = schema.parse(process.env);
