import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Construct } from "constructs";
import { LambdaFunction } from "../../../../infra/lib/constructs/lambda-function";
import { lambdaName } from "../../../../shared/openapi/cloudwatch";
import * as path from "path";

interface PublicConstructProps {
  api: HttpApi;
  environment: Record<string, string>;
  stage: string;
}

export class PublicConstruct extends Construct {
  constructor(scope: Construct, id: string, props: PublicConstructProps) {
    super(scope, id);

    const { api, environment, stage } = props;

    const profile = new LambdaFunction(this, "PublicProfileFn", {
      entry: path.join(__dirname, "../handlers/get-public-profile.handler.ts"),
      functionName: lambdaName(stage, "public-profile"),
      environment,
    });
    api.addRoutes({ path: "/api/public/{username}", methods: [HttpMethod.GET], integration: new HttpLambdaIntegration("PublicProfileIntegration", profile) });

    const links = new LambdaFunction(this, "PublicLinksFn", {
      entry: path.join(__dirname, "../handlers/get-public-links.handler.ts"),
      functionName: lambdaName(stage, "public-links"),
      environment,
    });
    api.addRoutes({ path: "/api/public/{username}/links", methods: [HttpMethod.GET], integration: new HttpLambdaIntegration("PublicLinksIntegration", links) });
  }
}
