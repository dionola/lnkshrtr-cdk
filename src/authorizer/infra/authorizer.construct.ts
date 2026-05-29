import { Duration } from "aws-cdk-lib";
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { Construct } from "constructs";
import { LambdaFunction } from "../../../infra/lib/constructs/lambda-function";
import { lambdaName } from "../../../shared/openapi/cloudwatch";
import * as path from "path";

interface AuthorizerConstructProps {
  environment: Record<string, string>;
  stage: string;
}

export class AuthorizerConstruct extends Construct {
  public readonly authorizer: HttpLambdaAuthorizer;

  constructor(scope: Construct, id: string, props: AuthorizerConstructProps) {
    super(scope, id);

    const fn = new LambdaFunction(this, "AuthorizerFn", {
      entry: path.join(__dirname, "../handler.ts"),
      functionName: lambdaName(props.stage, "authorizer"),
      environment: props.environment,
    });

    this.authorizer = new HttpLambdaAuthorizer("JwtAuthorizer", fn, {
      responseTypes: [HttpLambdaResponseType.SIMPLE],
      resultsCacheTtl: Duration.seconds(0),
      identitySource: ["$request.header.Authorization"],
    });
  }
}
