import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Construct } from "constructs";
import { LambdaFunction } from "../../../../infra/lib/constructs/lambda-function";
import { lambdaName } from "../../../../shared/openapi/cloudwatch";
import * as path from "path";

interface DocsConstructProps {
  api: HttpApi;
  stage: string;
  apiEndpoint: string;
}

export class DocsConstruct extends Construct {
  constructor(scope: Construct, id: string, props: DocsConstructProps) {
    super(scope, id);

    const { api, stage, apiEndpoint } = props;

    const env = {
      STAGE: stage,
      API_ENDPOINT: apiEndpoint,
    };

    const ui = new LambdaFunction(this, "DocsFn", {
      entry: path.join(__dirname, "../handlers/ui.handler.ts"),
      functionName: lambdaName(stage, "docs-ui"),
      environment: env,
    });
    api.addRoutes({
      path: "/docs",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("DocsUiIntegration", ui),
    });

    const spec = new LambdaFunction(this, "SpecFn", {
      entry: path.join(__dirname, "../handlers/spec.handler.ts"),
      functionName: lambdaName(stage, "docs-spec"),
      environment: env,
    });
    api.addRoutes({
      path: "/docs/openapi.json",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("DocsSpecIntegration", spec),
    });
  }
}
