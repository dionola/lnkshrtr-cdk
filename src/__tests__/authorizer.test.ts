import type { APIGatewayRequestAuthorizerEventV2 } from "aws-lambda";
import { handler } from "../authorizer/handler";
import { createUser, makeExpiredToken, makeMalformedToken, signFakeToken } from "./helpers/factories";

function buildAuthEvent(token?: string): APIGatewayRequestAuthorizerEventV2 {
  return {
    type: "REQUEST",
    routeArn: "arn:aws:execute-api:us-east-1:000000000000:test/$default/GET/api/auth/me",
    identitySource: token ? `Bearer ${token}` : "",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    rawPath: "/api/auth/me",
    rawQueryString: "",
    requestContext: {
      accountId: "000000000000",
      apiId: "test",
      domainName: "localhost",
      domainPrefix: "test",
      http: { method: "GET", path: "/api/auth/me", protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "jest" },
      requestId: "test",
      routeKey: "GET /api/auth/me",
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    version: "2.0",
  } as unknown as APIGatewayRequestAuthorizerEventV2;
}

describe("Lambda Authorizer", () => {
  it("returns isAuthorized=true with context for a valid token and existing user", async () => {
    const user = await createUser({ username: "authuser", email: "auth@example.com" });
    const token = signFakeToken(user.id);

    const result = await handler(buildAuthEvent(token));

    expect(result.isAuthorized).toBe(true);
    if (result.isAuthorized && result.context) {
      expect(result.context.userId).toBe(user.id);
      expect(result.context.username).toBe("authuser");
      expect(result.context.email).toBe("auth@example.com");
    }
  });

  it("returns isAuthorized=false when no Authorization header", async () => {
    const result = await handler(buildAuthEvent());
    expect(result.isAuthorized).toBe(false);
  });

  it("returns isAuthorized=false for a malformed token", async () => {
    const result = await handler(buildAuthEvent(makeMalformedToken()));
    expect(result.isAuthorized).toBe(false);
  });

  it("returns isAuthorized=false for an expired token", async () => {
    const user = await createUser();
    const expired = makeExpiredToken(user.id);
    const result = await handler(buildAuthEvent(expired));
    expect(result.isAuthorized).toBe(false);
  });

  it("returns isAuthorized=false when token references a non-existent user", async () => {
    const token = signFakeToken("nonexistent-user-id");
    const result = await handler(buildAuthEvent(token));
    expect(result.isAuthorized).toBe(false);
  });

  it("context includes all expected fields", async () => {
    const user = await createUser({ username: "contextcheck", email: "ctx@example.com" });
    const token = signFakeToken(user.id);

    const result = await handler(buildAuthEvent(token));

    expect(result.isAuthorized).toBe(true);
    if (result.isAuthorized && result.context) {
      expect(result.context.userId).toBeDefined();
      expect(result.context.username).toBeDefined();
      expect(result.context.email).toBeDefined();
      expect(result.context.createdAt).toBeDefined();
    }
  });
});
