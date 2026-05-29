jest.mock("../../shared/utils/cache", () => ({
  cache: {
    invalidateLinkByCode: jest.fn().mockResolvedValue(undefined),
    invalidateAll: jest.fn().mockResolvedValue(undefined),
  },
}));

import type { SQSEvent } from "aws-lambda";
import { handler } from "../modules/links/click-consumer.handler";
import { createLink } from "./helpers/factories";
import { db } from "../../shared/db";
import { links } from "../../shared/db/schema";
import { eq } from "drizzle-orm";

function buildSQSEvent(records: { shortCode: string }[]): SQSEvent {
  return {
    Records: records.map((r, i) => ({
      messageId: `msg-${i}`,
      receiptHandle: `receipt-${i}`,
      body: JSON.stringify(r),
      attributes: {
        ApproximateReceiveCount: "1",
        SentTimestamp: String(Date.now()),
        SenderId: "test",
        ApproximateFirstReceiveTimestamp: String(Date.now()),
      },
      messageAttributes: {},
      md5OfBody: "",
      eventSource: "aws:sqs",
      eventSourceARN: "arn:aws:sqs:us-east-1:000000000000:test-queue",
      awsRegion: "us-east-1",
    })),
  };
}

// ─── Click consumer ───────────────────────────────────────────────────────────

describe("click-consumer handler", () => {
  it("increments visit count for a single record", async () => {
    await createLink({ shortCode: "clk001", visits: 5 });

    await handler(buildSQSEvent([{ shortCode: "clk001" }]));

    const [dbLink] = await db.select().from(links).where(eq(links.shortCode, "clk001")).limit(1);
    expect(dbLink.visits).toBe(6);
  });

  it("processes multiple records in a single batch", async () => {
    await createLink({ shortCode: "batch01", visits: 0 });
    await createLink({ shortCode: "batch02", visits: 10 });

    await handler(buildSQSEvent([{ shortCode: "batch01" }, { shortCode: "batch02" }]));

    const [l1] = await db.select().from(links).where(eq(links.shortCode, "batch01")).limit(1);
    const [l2] = await db.select().from(links).where(eq(links.shortCode, "batch02")).limit(1);
    expect(l1.visits).toBe(1);
    expect(l2.visits).toBe(11);
  });

  it("increments by exactly 1 each call", async () => {
    await createLink({ shortCode: "exact01", visits: 100 });

    await handler(buildSQSEvent([{ shortCode: "exact01" }]));
    await handler(buildSQSEvent([{ shortCode: "exact01" }]));

    const [dbLink] = await db.select().from(links).where(eq(links.shortCode, "exact01")).limit(1);
    expect(dbLink.visits).toBe(102);
  });

  it("invalidates cache after incrementing", async () => {
    const { cache } = jest.requireMock("../../shared/utils/cache") as {
      cache: { invalidateLinkByCode: jest.Mock };
    };

    await createLink({ shortCode: "cache01", visits: 0 });
    await handler(buildSQSEvent([{ shortCode: "cache01" }]));

    expect(cache.invalidateLinkByCode).toHaveBeenCalledWith("cache01");
  });

  it("throws on malformed message body — SQS retries the record", async () => {
    const badEvent: SQSEvent = {
      Records: [{
        messageId: "bad",
        receiptHandle: "bad",
        body: "not-json",
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: String(Date.now()),
          SenderId: "test",
          ApproximateFirstReceiveTimestamp: String(Date.now()),
        },
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "arn:aws:sqs:us-east-1:000000000000:test-queue",
        awsRegion: "us-east-1",
      }],
    };

    await expect(handler(badEvent)).rejects.toThrow();
  });
});
