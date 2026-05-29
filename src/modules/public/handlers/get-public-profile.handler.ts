import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { getPublicProfile } from "../public.service";
import { handleError } from "../../../../shared/utils/response";

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    return await getPublicProfile(event);
  } catch (err) {
    return handleError(err);
  }
};
