import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { HttpApi, CorsHttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { AuthorizerConstruct } from "../../../src/authorizer/infra/authorizer.construct";
import { AuthConstruct } from "../../../src/modules/auth/infra/auth.construct";
import { LinksConstruct } from "../../../src/modules/links/infra/links.construct";
import { PublicConstruct } from "../../../src/modules/public/infra/public.construct";
import { HealthConstruct } from "../../../src/modules/health/infra/health.construct";
import { DocsConstruct } from "../../../src/modules/docs/infra/docs.construct";

interface LnkshrtrStackProps extends StackProps {
  appEnv: Record<string, string>;
  stage: string;
}

export class LnkshrtrStack extends Stack {
  public readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: LnkshrtrStackProps) {
    super(scope, id, props);

    const { appEnv: e, stage } = props;
    const region = this.region;

    const api = new HttpApi(this, "HttpApi", {
      corsPreflight: {
        allowOrigins: [e.FRONTEND_URL],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.PUT, CorsHttpMethod.DELETE, CorsHttpMethod.OPTIONS],
        allowHeaders: ["Content-Type", "Authorization"],
        allowCredentials: true,
      },
    });

    const { authorizer: jwtAuthorizer } = new AuthorizerConstruct(this, "Authorizer", {
      stage,
      environment: {
        DATABASE_URL: e.DATABASE_URL,
        JWT_SECRET: e.JWT_SECRET,
      },
    });

    const clickQueue = new Queue(this, "ClickEventsQueue", {
      queueName: `lnkshrtr-${stage}-click-events`,
    });

    new HealthConstruct(this, "Health", {
      api,
      stage,
      environment: {
        DATABASE_URL: e.DATABASE_URL,
        UPSTASH_REDIS_URL: e.UPSTASH_REDIS_URL ?? "",
        UPSTASH_REDIS_TOKEN: e.UPSTASH_REDIS_TOKEN ?? "",
      },
    });

    new AuthConstruct(this, "Auth", {
      api,
      jwtAuthorizer,
      stage,
      environment: {
        DATABASE_URL: e.DATABASE_URL,
        JWT_SECRET: e.JWT_SECRET,
        JWT_EXPIRES_IN: e.JWT_EXPIRES_IN ?? "7d",
        BCRYPT_ROUNDS: e.BCRYPT_ROUNDS ?? "10",
        FRONTEND_URL: e.FRONTEND_URL,
        GOOGLE_CLIENT_ID: e.GOOGLE_CLIENT_ID ?? "",
        GOOGLE_CLIENT_SECRET: e.GOOGLE_CLIENT_SECRET ?? "",
        GOOGLE_CALLBACK_URL: e.GOOGLE_CALLBACK_URL ?? "",
      },
    });

    new LinksConstruct(this, "Links", {
      api,
      jwtAuthorizer,
      clickQueue,
      stage,
      environment: {
        DATABASE_URL: e.DATABASE_URL,
        JWT_SECRET: e.JWT_SECRET,
        BCRYPT_ROUNDS: e.BCRYPT_ROUNDS ?? "10",
        UPSTASH_REDIS_URL: e.UPSTASH_REDIS_URL ?? "",
        UPSTASH_REDIS_TOKEN: e.UPSTASH_REDIS_TOKEN ?? "",
        CLICK_QUEUE_URL: clickQueue.queueUrl,
      },
    });

    new PublicConstruct(this, "Public", {
      api,
      stage,
      environment: {
        DATABASE_URL: e.DATABASE_URL,
        UPSTASH_REDIS_URL: e.UPSTASH_REDIS_URL ?? "",
        UPSTASH_REDIS_TOKEN: e.UPSTASH_REDIS_TOKEN ?? "",
      },
    });

    new DocsConstruct(this, "Docs", {
      api,
      stage,
      apiEndpoint: api.apiEndpoint,
    });

    this.apiEndpoint = api.apiEndpoint;

    // ── outputs (printed after every deploy) ─────────────────────────────

    new CfnOutput(this, "ApiEndpoint", {
      value: api.apiEndpoint,
      description: "HTTP API endpoint",
    });

    new CfnOutput(this, "DocsUrl", {
      value: `${api.apiEndpoint}/docs`,
      description: "Swagger UI",
    });

    new CfnOutput(this, "CloudWatchLogs", {
      value: `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups$3FlogGroupNameFilter$3D%2Faws%2Flambda%2Flnkshrtr-${stage}-`,
      description: "CloudWatch log groups (all lambdas for this stage)",
    });
  }
}
