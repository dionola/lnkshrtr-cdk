import { HttpApi, HttpMethod, HttpRoute } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { IHttpRouteAuthorizer } from "aws-cdk-lib/aws-apigatewayv2";

interface AddRouteProps {
  api: HttpApi;
  path: string;
  method: HttpMethod;
  integration: HttpLambdaIntegration;
  authorizer?: IHttpRouteAuthorizer;
}

export function addRoute(props: AddRouteProps): HttpRoute[] {
  return props.api.addRoutes({
    path: props.path,
    methods: [props.method],
    integration: props.integration,
    authorizer: props.authorizer,
  });
}
