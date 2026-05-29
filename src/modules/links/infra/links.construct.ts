import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { IHttpRouteAuthorizer } from "aws-cdk-lib/aws-apigatewayv2";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { IQueue } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { LambdaFunction } from "../../../../infra/lib/constructs/lambda-function";
import { lambdaName } from "../../../../shared/openapi/cloudwatch";
import * as path from "path";

interface LinksConstructProps {
  api: HttpApi;
  jwtAuthorizer: IHttpRouteAuthorizer;
  clickQueue: IQueue;
  environment: Record<string, string>;
  stage: string;
}

export class LinksConstruct extends Construct {
  constructor(scope: Construct, id: string, props: LinksConstructProps) {
    super(scope, id);

    const { api, jwtAuthorizer, clickQueue, environment, stage } = props;

    const getLinks = new LambdaFunction(this, "GetLinksFn", {
      entry: path.join(__dirname, "../handlers/get-links.handler.ts"),
      functionName: lambdaName(stage, "links-get"),
      environment,
    });
    api.addRoutes({ path: "/api/links", methods: [HttpMethod.GET], integration: new HttpLambdaIntegration("GetLinksIntegration", getLinks), authorizer: jwtAuthorizer });

    const createLink = new LambdaFunction(this, "CreateLinkFn", {
      entry: path.join(__dirname, "../handlers/create-link.handler.ts"),
      functionName: lambdaName(stage, "links-create"),
      environment,
    });
    api.addRoutes({ path: "/api/links", methods: [HttpMethod.POST], integration: new HttpLambdaIntegration("CreateLinkIntegration", createLink) });

    const updateLink = new LambdaFunction(this, "UpdateLinkFn", {
      entry: path.join(__dirname, "../handlers/update-link.handler.ts"),
      functionName: lambdaName(stage, "links-update"),
      environment,
    });
    api.addRoutes({ path: "/api/links/{id}", methods: [HttpMethod.PUT], integration: new HttpLambdaIntegration("UpdateLinkIntegration", updateLink), authorizer: jwtAuthorizer });

    const deleteLink = new LambdaFunction(this, "DeleteLinkFn", {
      entry: path.join(__dirname, "../handlers/delete-link.handler.ts"),
      functionName: lambdaName(stage, "links-delete"),
      environment,
    });
    api.addRoutes({ path: "/api/links/{id}", methods: [HttpMethod.DELETE], integration: new HttpLambdaIntegration("DeleteLinkIntegration", deleteLink), authorizer: jwtAuthorizer });

    const getLinkByCode = new LambdaFunction(this, "GetLinkByCodeFn", {
      entry: path.join(__dirname, "../handlers/get-link-by-code.handler.ts"),
      functionName: lambdaName(stage, "links-get-by-code"),
      environment,
    });
    api.addRoutes({ path: "/api/links/code/{shortCode}", methods: [HttpMethod.GET], integration: new HttpLambdaIntegration("GetLinkByCodeIntegration", getLinkByCode) });

    const verifyPassword = new LambdaFunction(this, "VerifyPasswordFn", {
      entry: path.join(__dirname, "../handlers/verify-link-password.handler.ts"),
      functionName: lambdaName(stage, "links-verify-password"),
      environment,
    });
    api.addRoutes({ path: "/api/links/code/{shortCode}", methods: [HttpMethod.POST], integration: new HttpLambdaIntegration("VerifyPasswordIntegration", verifyPassword) });

    const recordClick = new LambdaFunction(this, "RecordClickFn", {
      entry: path.join(__dirname, "../handlers/record-click.handler.ts"),
      functionName: lambdaName(stage, "links-record-click"),
      environment,
    });
    clickQueue.grantSendMessages(recordClick);
    api.addRoutes({ path: "/api/links/code/{shortCode}/click", methods: [HttpMethod.POST], integration: new HttpLambdaIntegration("RecordClickIntegration", recordClick) });

    const consumerFn = new LambdaFunction(this, "ClickConsumerFn", {
      entry: path.join(__dirname, "../click-consumer.handler.ts"),
      functionName: lambdaName(stage, "links-click-consumer"),
      environment: {
        DATABASE_URL: environment.DATABASE_URL,
        UPSTASH_REDIS_URL: environment.UPSTASH_REDIS_URL ?? "",
        UPSTASH_REDIS_TOKEN: environment.UPSTASH_REDIS_TOKEN ?? "",
      },
    });
    consumerFn.addEventSource(new SqsEventSource(clickQueue, { batchSize: 10 }));
    clickQueue.grantConsumeMessages(consumerFn);
  }
}
