import { Redis } from "@upstash/redis";
import { logger } from "../logger";

const TTL = 300;

let client: Redis | null = null;
try {
  if (process.env.UPSTASH_REDIS_URL && process.env.UPSTASH_REDIS_TOKEN) {
    client = new Redis({
      url: process.env.UPSTASH_REDIS_URL,
      token: process.env.UPSTASH_REDIS_TOKEN,
    });
  }
} catch (err) {
  logger.warn("Redis unavailable — caching disabled", { error: (err as Error).message });
}

async function get<T>(key: string): Promise<T | null> {
  if (!client) return null;
  try {
    return await client.get<T>(key);
  } catch {
    return null;
  }
}

async function set(key: string, value: unknown, ttl = TTL): Promise<void> {
  if (!client) return;
  try {
    await client.set(key, JSON.stringify(value), { ex: ttl });
  } catch {
    // graceful degradation
  }
}

async function del(key: string): Promise<void> {
  if (!client) return;
  try {
    await client.del(key);
  } catch {
    // graceful degradation
  }
}

export const cache = {
  getLinkByCode: (shortCode: string) => get(`link:code:${shortCode}`),
  setLinkByCode: (shortCode: string, value: unknown) => set(`link:code:${shortCode}`, value),
  invalidateLinkByCode: (shortCode: string) => del(`link:code:${shortCode}`),

  getUserLinks: (key: string) => get(`user:links:${key}`),
  setUserLinks: (key: string, value: unknown) => set(`user:links:${key}`, value),
  invalidateUserLinks: (userId: string) => del(`user:links:${userId}`),

  getPublicUser: (username: string) => get(`public:user:${username}`),
  setPublicUser: (username: string, value: unknown) => set(`public:user:${username}`, value),

  getPublicLinks: (key: string) => get(`public:links:${key}`),
  setPublicLinks: (key: string, value: unknown) => set(`public:links:${key}`, value),

  async invalidateAll({ linkCode, userId }: { linkCode?: string; userId?: string }) {
    const ops: Promise<void>[] = [];
    if (linkCode) ops.push(del(`link:code:${linkCode}`));
    if (userId) ops.push(del(`user:links:${userId}`));
    await Promise.all(ops);
  },
};
