import type { APIGatewayRequestAuthorizerEventV2 } from "aws-lambda";

type AuthorizerResult =
  | { isAuthorized: false }
  | { isAuthorized: true; context: Record<string, string> };
import { eq } from "drizzle-orm";
import { db, users } from "../../shared/db";
import { verifyToken } from "../../shared/utils/jwt";
import { logger } from "../../shared/logger";

export const handler = async (
  event: APIGatewayRequestAuthorizerEventV2
): Promise<AuthorizerResult> => {
  try {
    const token = event.headers?.authorization?.slice(7);
    if (!token) return { isAuthorized: false };

    const { sub } = verifyToken(token);

    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, sub))
      .limit(1);

    if (!user) return { isAuthorized: false };

    return {
      isAuthorized: true,
      context: {
        userId: user.id,
        username: user.username,
        email: user.email,
        createdAt: user.createdAt.toISOString(),
      },
    };
  } catch (err) {
    logger.warn("Authorizer rejected request", { error: (err as Error).message });
    return { isAuthorized: false };
  }
};
