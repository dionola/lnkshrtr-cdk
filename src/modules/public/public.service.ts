import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { publicRepository } from "./public.repository";
import { AppError } from "../../../shared/utils/errors";
import { ok } from "../../../shared/utils/response";
import { cache } from "../../../shared/utils/cache";
import type { UserResponse, LinkResponse } from "../../../shared/types";

function toUserResponse(user: { id: string; username: string; email: string; createdAt: Date }): UserResponse {
  return { id: user.id, username: user.username, email: user.email, createdAt: user.createdAt };
}

export async function getPublicProfile(event: APIGatewayProxyEventV2) {
  const username = event.pathParameters?.username;
  if (!username) throw new AppError(400, "BAD_REQUEST", "Missing username");

  const cached = await cache.getPublicUser(username);
  if (cached) return ok(cached);

  const user = await publicRepository.findUserByUsername(username);
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");

  const response = toUserResponse(user);
  await cache.setPublicUser(username, response);
  return ok(response);
}

export async function getPublicLinks(event: APIGatewayProxyEventV2) {
  const username = event.pathParameters?.username;
  if (!username) throw new AppError(400, "BAD_REQUEST", "Missing username");

  const type = event.queryStringParameters?.type;
  const cacheKey = type ? `${username}:${type}` : username;

  const cached = await cache.getPublicLinks(cacheKey);
  if (cached) return ok(cached);

  const user = await publicRepository.findUserByUsername(username);
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found");

  const links = await publicRepository.findPublicLinksByUsername(username, type);
  const response: LinkResponse[] = links.map((link) => ({
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
  }));

  await cache.setPublicLinks(cacheKey, response);
  return ok(response);
}
