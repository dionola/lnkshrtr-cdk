import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Construct } from "constructs";
import { LambdaFunction } from "../../../../infra/lib/constructs/lambda-function";
import { lambdaName } from "../../../../shared/openapi/cloudwatch";
import * as path from "path";

interface HealthConstructProps {
  api: HttpApi;
  environment: Record<string, string>;
  stage: string;
}

export class HealthConstruct extends Construct {
  constructor(scope: Construct, id: string, props: HealthConstructProps) {
    super(scope, id);

    const { api, environment, stage } = props;

    const health = new LambdaFunction(this, "HealthFn", {
      entry: path.join(__dirname, "../handlers/health.handler.ts"),
      functionName: lambdaName(stage, "health"),
      environment,
    });
    api.addRoutes({ path: "/health", methods: [HttpMethod.GET], integration: new HttpLambdaIntegration("HealthIntegration", health) });

    const live = new LambdaFunction(this, "LiveFn", {
      entry: path.join(__dirname, "../handlers/live.handler.ts"),
      functionName: lambdaName(stage, "health-live"),
      environment,
    });
    api.addRoutes({ path: "/health/live", methods: [HttpMethod.GET], integration: new HttpLambdaIntegration("LiveIntegration", live) });

    const ready = new LambdaFunction(this, "ReadyFn", {
      entry: path.join(__dirname, "../handlers/ready.handler.ts"),
      functionName: lambdaName(stage, "health-ready"),
      environment,
    });
    api.addRoutes({ path: "/health/ready", methods: [HttpMethod.GET], integration: new HttpLambdaIntegration("ReadyIntegration", ready) });
  }
}
