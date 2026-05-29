import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { ok } from "../../../../shared/utils/response";

const startTime = Date.now();

export const handler = async (_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  return ok({ status: "ok", uptime: Math.floor((Date.now() - startTime) / 1000) });
};
