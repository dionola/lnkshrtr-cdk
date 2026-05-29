import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { ZodError } from "zod";
import { AppError } from "./errors";
import { logger } from "../logger";

const JSON_HEADERS = { "Content-Type": "application/json" };

export function ok(body: unknown, statusCode = 200): APIGatewayProxyResultV2 {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

export function noContent(): APIGatewayProxyResultV2 {
  return { statusCode: 204, body: "" };
}

export function redirect(url: string): APIGatewayProxyResultV2 {
  return { statusCode: 302, headers: { Location: url }, body: "" };
}

export function handleError(err: unknown): APIGatewayProxyResultV2 {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: { code: err.code, message: err.message } }),
    };
  }

  if (err instanceof ZodError) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: err.errors,
        },
      }),
    };
  }

  logger.error("Unhandled error", { error: (err as Error).message, stack: (err as Error).stack });
  return {
    statusCode: 500,
    headers: JSON_HEADERS,
    body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }),
  };
}
