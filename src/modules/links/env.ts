import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  BCRYPT_ROUNDS: z.coerce.number().default(10),
  UPSTASH_REDIS_URL: z.string().optional(),
  UPSTASH_REDIS_TOKEN: z.string().optional(),
  CLICK_QUEUE_URL: z.string().min(1),
});

export const env = schema.parse(process.env);
