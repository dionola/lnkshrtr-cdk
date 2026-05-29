import { z } from "zod";

export const createLinkSchema = z.object({
  url: z.string().url(),
  customCode: z.string().min(3).max(20).optional(),
  isPublic: z.boolean().default(true),
  isPasswordProtected: z.boolean().default(false),
  password: z.string().optional(),
  type: z.string().default("link"),
});

export const updateLinkSchema = z.object({
  title: z.string().optional(),
  isPublic: z.boolean().optional(),
  isActive: z.boolean().optional(),
  isPasswordProtected: z.boolean().optional(),
  password: z.string().optional(),
});

export const verifyPasswordSchema = z.object({
  password: z.string(),
});

export const getUserLinksQuerySchema = z.object({
  type: z.string().optional(),
});

export type CreateLinkInput = z.infer<typeof createLinkSchema>;
export type UpdateLinkInput = z.infer<typeof updateLinkSchema>;
