import bcrypt from "bcryptjs";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { eq } from "drizzle-orm";
import { db, links } from "../../../shared/db";
import { linksRepository } from "./links.repository";
import {
  createLinkSchema,
  updateLinkSchema,
  verifyPasswordSchema,
  getUserLinksQuerySchema,
} from "./links.validator";
import { generateUniqueShortCode } from "../../../shared/utils/short-code";
import { cache } from "../../../shared/utils/cache";
import { AppError } from "../../../shared/utils/errors";
import { ok, noContent, handleError } from "../../../shared/utils/response";
import { verifyToken } from "../../../shared/utils/jwt";
import { env } from "./env";
import { logger } from "../../../shared/logger";
import type { LinkResponse } from "../../../shared/types";

const sqs = new SQSClient({});

function toLinkResponse(link: typeof links.$inferSelect): LinkResponse {
  return {
    id: link.id,
    shortCode: link.shortCode,
    originalUrl: link.originalUrl,
    title: link.title,
    isPublic: link.isPublic,
    isActive: link.isActive,
    isPasswordProtected: link.isPasswordProtected,
    userId: link.userId,
    type: link.type,
    visits: link.visits,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}

function extractTitle(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 50);
  }
}

function getOptionalUserId(event: APIGatewayProxyEventV2): string | null {
  const token = event.headers?.authorization?.slice(7);
  if (!token) return null;
  try {
    const { sub } = verifyToken(token);
    return sub;
  } catch {
    return null;
  }
}

export async function getLinkByCode(event: APIGatewayProxyEventV2) {
  const shortCode = event.pathParameters?.shortCode;
  if (!shortCode) throw new AppError(400, "BAD_REQUEST", "Missing shortCode");

  const cached = await cache.getLinkByCode(shortCode);
  if (cached) return ok(cached);

  const link = await linksRepository.findByShortCode(shortCode);
  if (!link) throw new AppError(404, "NOT_FOUND", "Short code not found");

  const response = toLinkResponse(link);
  await cache.setLinkByCode(shortCode, response);
  return ok(response);
}

export async function verifyLinkPassword(event: APIGatewayProxyEventV2) {
  const shortCode = event.pathParameters?.shortCode;
  if (!shortCode) throw new AppError(400, "BAD_REQUEST", "Missing shortCode");

  const { password } = verifyPasswordSchema.parse(JSON.parse(event.body ?? "{}"));

  const link = await db
    .select({ password: links.password, isPasswordProtected: links.isPasswordProtected })
    .from(links)
    .where(eq(links.shortCode, shortCode))
    .limit(1)
    .then((r) => r[0]);

  if (!link) throw new AppError(404, "NOT_FOUND", "Short code not found");
  if (!link.isPasswordProtected || !link.password) return ok(true);

  return ok(await bcrypt.compare(password, link.password));
}

export async function recordClick(event: APIGatewayProxyEventV2) {
  const shortCode = event.pathParameters?.shortCode;
  if (!shortCode) throw new AppError(400, "BAD_REQUEST", "Missing shortCode");

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: env.CLICK_QUEUE_URL,
      MessageBody: JSON.stringify({ shortCode }),
    })
  );

  return ok({});
}

export async function createLink(event: APIGatewayProxyEventV2) {
  const body = createLinkSchema.parse(JSON.parse(event.body ?? "{}"));
  const userId = getOptionalUserId(event);

  if (body.customCode) {
    const exists = await linksRepository.findByShortCode(body.customCode);
    if (exists) throw new AppError(409, "CONFLICT", "Short code is already in use");
  }

  const shortCode = body.customCode ?? (await generateUniqueShortCode());
  const hashedPassword =
    body.isPasswordProtected && body.password
      ? await bcrypt.hash(body.password, env.BCRYPT_ROUNDS)
      : null;

  const link = await linksRepository.create({
    shortCode,
    originalUrl: body.url,
    title: extractTitle(body.url),
    isPublic: body.isPublic,
    isPasswordProtected: body.isPasswordProtected,
    password: hashedPassword,
    userId,
    type: body.type,
  });

  if (userId) await cache.invalidateUserLinks(userId);
  logger.info("Link created", { linkId: link.id, userId, shortCode: link.shortCode });

  return ok(toLinkResponse(link), 201);
}

export async function getUserLinks(event: APIGatewayProxyEventV2) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userId = (event.requestContext as any).authorizer?.lambda?.userId as string;
  const { type } = getUserLinksQuerySchema.parse(event.queryStringParameters ?? {});

  const cacheKey = type ? `${userId}:${type}` : userId;
  const cached = await cache.getUserLinks(cacheKey);
  if (cached) return ok(cached);

  const userLinks = await linksRepository.findByUser(userId, type);
  const response = userLinks.map(toLinkResponse);
  await cache.setUserLinks(cacheKey, response);
  return ok(response);
}

export async function updateLink(event: APIGatewayProxyEventV2) {
  const body = updateLinkSchema.parse(JSON.parse(event.body ?? "{}"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userId = (event.requestContext as any).authorizer?.lambda?.userId as string;
  const id = event.pathParameters?.id;
  if (!id) throw new AppError(400, "BAD_REQUEST", "Missing link id");

  const existing = await linksRepository.findById(id);
  if (!existing) throw new AppError(404, "NOT_FOUND", "Link not found");
  if (existing.userId !== userId) throw new AppError(403, "FORBIDDEN", "You do not own this link");

  const updateData: Parameters<typeof linksRepository.update>[1] = {};
  if (body.title !== undefined) updateData.title = body.title;
  if (body.isPublic !== undefined) updateData.isPublic = body.isPublic;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;
  if (body.isPasswordProtected !== undefined) {
    updateData.isPasswordProtected = body.isPasswordProtected;
    if (body.isPasswordProtected && body.password) {
      updateData.password = await bcrypt.hash(body.password, env.BCRYPT_ROUNDS);
    } else if (!body.isPasswordProtected) {
      updateData.password = null;
    }
  }

  const updated = await linksRepository.update(id, updateData);
  await cache.invalidateAll({ linkCode: existing.shortCode, userId });
  logger.info("Link updated", { linkId: id, userId });

  return ok(toLinkResponse(updated));
}

export async function deleteLink(event: APIGatewayProxyEventV2) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userId = (event.requestContext as any).authorizer?.lambda?.userId as string;
  const id = event.pathParameters?.id;
  if (!id) throw new AppError(400, "BAD_REQUEST", "Missing link id");

  const existing = await linksRepository.findById(id);
  if (!existing) throw new AppError(404, "NOT_FOUND", "Link not found");
  if (existing.userId !== userId) throw new AppError(403, "FORBIDDEN", "You do not own this link");

  await linksRepository.delete(id);
  await cache.invalidateAll({ linkCode: existing.shortCode, userId });
  logger.info("Link deleted", { linkId: id, userId });

  return noContent();
}

export { handleError };
