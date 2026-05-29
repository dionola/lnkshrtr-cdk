import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { buildSpec } from "../../../../shared/openapi/spec";
import { env } from "../env";

const spec = buildSpec(env.STAGE, env.AWS_REGION, env.API_ENDPOINT);

export const handler = async (_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(spec),
  };
};
