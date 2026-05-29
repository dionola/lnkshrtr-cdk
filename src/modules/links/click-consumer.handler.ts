import type { SQSEvent } from "aws-lambda";
import { eq, sql } from "drizzle-orm";
import { db, links } from "../../../shared/db";
import { cache } from "../../../shared/utils/cache";
import { logger } from "../../../shared/logger";

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    let shortCode: string | undefined;
    try {
      ({ shortCode } = JSON.parse(record.body) as { shortCode: string });
      await db
        .update(links)
        .set({ visits: sql`${links.visits} + 1` })
        .where(eq(links.shortCode, shortCode));
      await cache.invalidateLinkByCode(shortCode);
      logger.info("Visit recorded", { shortCode });
    } catch (err) {
      logger.warn("Failed to record visit", { shortCode, error: (err as Error).message });
      throw err;
    }
  }
};
