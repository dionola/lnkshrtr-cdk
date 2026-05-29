import { z } from "zod";

const schema = z.object({
  STAGE: z.string().default("prod"),
  AWS_REGION: z.string().default("ap-southeast-1"),
  API_ENDPOINT: z.string().default(""),
});

export const env = schema.parse(process.env);
