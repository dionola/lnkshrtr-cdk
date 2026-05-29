import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { IHttpRouteAuthorizer } from "aws-cdk-lib/aws-apigatewayv2";
import { Construct } from "constructs";
import { LambdaFunction } from "../../../../infra/lib/constructs/lambda-function";
import { lambdaName } from "../../../../shared/openapi/cloudwatch";
import * as path from "path";

interface AuthConstructProps {
  api: HttpApi;
  jwtAuthorizer: IHttpRouteAuthorizer;
  environment: Record<string, string>;
  stage: string;
}

export class AuthConstruct extends Construct {
  constructor(scope: Construct, id: string, props: AuthConstructProps) {
    super(scope, id);

    const { api, jwtAuthorizer, environment, stage } = props;

    const signup = new LambdaFunction(this, "SignupFn", {
      entry: path.join(__dirname, "../handlers/signup.handler.ts"),
      functionName: lambdaName(stage, "auth-signup"),
      environment,
    });
    api.addRoutes({ path: "/api/auth/signup", methods: [HttpMethod.POST], integration: new HttpLambdaIntegration("SignupIntegration", signup) });

    const login = new LambdaFunction(this, "LoginFn", {
      entry: path.join(__dirname, "../handlers/login.handler.ts"),
      functionName: lambdaName(stage, "auth-login"),
      environment,
    });
    api.addRoutes({ path: "/api/auth/login", methods: [HttpMethod.POST], integration: new HttpLambdaIntegration("LoginIntegration", login) });

    const me = new LambdaFunction(this, "MeFn", {
      entry: path.join(__dirname, "../handlers/me.handler.ts"),
      functionName: lambdaName(stage, "auth-me"),
      environment,
    });
    api.addRoutes({ path: "/api/auth/me", methods: [HttpMethod.GET], integration: new HttpLambdaIntegration("MeIntegration", me), authorizer: jwtAuthorizer });

    const google = new LambdaFunction(this, "GoogleFn", {
      entry: path.join(__dirname, "../handlers/google.handler.ts"),
      functionName: lambdaName(stage, "auth-google"),
      environment,
    });
    api.addRoutes({ path: "/api/auth/google", methods: [HttpMethod.GET], integration: new HttpLambdaIntegration("GoogleIntegration", google) });

    const googleCallback = new LambdaFunction(this, "GoogleCallbackFn", {
      entry: path.join(__dirname, "../handlers/google-callback.handler.ts"),
      functionName: lambdaName(stage, "auth-google-callback"),
      environment,
    });
    api.addRoutes({ path: "/api/auth/google/callback", methods: [HttpMethod.GET], integration: new HttpLambdaIntegration("GoogleCallbackIntegration", googleCallback) });
  }
}
