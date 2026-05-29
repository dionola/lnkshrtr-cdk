import type { APIGatewayProxyEventV2 } from "aws-lambda";

interface EventOpts {
  routeKey?: string;
  body?: unknown;
  headers?: Record<string, string>;
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  authContext?: { userId: string; username?: string; email?: string };
}

export function buildEvent(opts: EventOpts): APIGatewayProxyEventV2 {
  return {
    routeKey: opts.routeKey ?? "",
    rawPath: "",
    rawQueryString: "",
    headers: opts.headers ?? {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    pathParameters: opts.pathParameters,
    queryStringParameters: opts.queryStringParameters,
    isBase64Encoded: false,
    requestContext: {
      accountId: "000000000000",
      apiId: "test",
      domainName: "localhost",
      domainPrefix: "test",
      http: {
        method: "GET",
        path: "/",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "jest",
      },
      requestId: "test-request-id",
      routeKey: opts.routeKey ?? "",
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
      authorizer: opts.authContext
        ? { lambda: opts.authContext }
        : undefined,
    },
    version: "2.0",
  } as unknown as APIGatewayProxyEventV2;
}

export function withBearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
