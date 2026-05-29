import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { sql } from "drizzle-orm";
import { db } from "../../../../shared/db";
import { ok } from "../../../../shared/utils/response";
import { logger } from "../../../../shared/logger";

export const handler = async (_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const checks: Record<string, string> = {};

  try {
    await db.execute(sql`SELECT 1`);
    checks.database = "ok";
  } catch (err) {
    logger.error("DB health check failed", { error: (err as Error).message });
    checks.database = "error";
  }

  try {
    if (process.env.UPSTASH_REDIS_URL && process.env.UPSTASH_REDIS_TOKEN) {
      const { Redis } = await import("@upstash/redis");
      const redis = new Redis({
        url: process.env.UPSTASH_REDIS_URL,
        token: process.env.UPSTASH_REDIS_TOKEN,
      });
      await redis.ping();
      checks.redis = "ok";
    } else {
      checks.redis = "disabled";
    }
  } catch (err) {
    logger.warn("Redis health check failed", { error: (err as Error).message });
    checks.redis = "error";
  }

  const allOk = Object.values(checks).every((v) => v === "ok" || v === "disabled");
  return ok({ status: allOk ? "ok" : "degraded", checks }, allOk ? 200 : 503);
};
