# Serverless Architecture on AWS with CDK

Reference document covering the architectural patterns used in this project and how to extend them. Written to be reusable as a starting point for new projects.

---

## Table of Contents

1. [Core stack choices](#core-stack-choices)
2. [Why these choices](#why-these-choices)
3. [API documentation](#api-documentation)
4. [Extending with new AWS patterns](#extending-with-new-aws-patterns)
   - [Standalone ECS service](#standalone-ecs-service)
   - [Lambda → ECS Fargate (long-running tasks)](#lambda--ecs-fargate-long-running-tasks)
   - [SQS patterns](#sqs-patterns)
   - [Step Functions](#step-functions)
   - [Lambda → Lambda (async)](#lambda--lambda-async)
   - [DynamoDB](#dynamodb)
   - [ElastiCache (Redis/Valkey)](#elasticache-redisvalkey)
5. [CloudWatch and observability](#cloudwatch-and-observability)

---

## Core stack choices

| Layer | Choice | Alternative considered |
|---|---|---|
| Compute | AWS Lambda (Node.js 22) | ECS Fargate, App Runner |
| API layer | API Gateway HTTP API v2 | REST API v1, ALB |
| Auth | Lambda Authorizer (JWT) | Cognito, API Gateway JWT Authorizer |
| Database | Neon (serverless Postgres, HTTP driver) | RDS, Aurora Serverless v2, PlanetScale |
| Cache | Upstash Redis (HTTP) | ElastiCache, Momento |
| ORM | Drizzle | Prisma, Kysely |
| Async tasks | SQS + consumer Lambda | EventBridge, Step Functions |
| IaC | AWS CDK (TypeScript) | Terraform, SST, Serverless Framework |
| Bundling | esbuild (via NodejsFunction) | webpack, tsc |
| Runtime schema | Zod | Joi, Yup |

---

## Why these choices

### API Gateway HTTP API v2, not REST API v1

HTTP API v2 is ~70% cheaper per million requests and has lower latency. It supports Lambda authorizers, CORS, and JWT authorizers natively. Use REST API v1 only when you need: request/response transformation, usage plans + API keys, per-route caching at the GW level, or VPC links to private HTTP services.

### Lambda Authorizer, not Cognito or built-in JWT

A Lambda Authorizer gives full control: you can reject requests based on any logic (deleted user, suspended account, feature flag) without waiting for a token to expire. The cost is one extra Lambda invocation per request (cached per `identitySource` + TTL if you enable caching).

Cognito makes sense when you need: user pools with email verification, social sign-in managed by AWS, MFA, or hosted UI. It's a heavier dependency for a simple JWT flow.

### Neon (serverless Postgres, HTTP driver), not RDS

Lambda functions don't hold persistent TCP connections well — each cold start opens a new connection, and warm instances idle-disconnect. RDS Proxy solves this but adds cost and latency. Neon's HTTP driver sends each query as an HTTP POST, making it connection-pool-free and Lambda-native. It performs identically to a standard Postgres driver for OLTP workloads. The tradeoff: no transaction isolation across multiple queries without explicit `neon.transaction()`.

For high-throughput applications requiring complex transactions, Aurora Serverless v2 + RDS Proxy is the correct choice.

### Upstash Redis (HTTP), not ElastiCache

ElastiCache requires a VPC, and putting Lambdas in a VPC adds ~100ms cold start penalty and requires NAT Gateway for internet access (~$32/month minimum). Upstash exposes Redis over HTTPS — no VPC, no persistent connection. The tradeoff: slightly higher per-command latency (~5–15ms vs <1ms for in-VPC ElastiCache). For cache TTLs of 300s, this is irrelevant.

Use ElastiCache if: you have existing VPC infrastructure, need sub-millisecond latency, or need Pub/Sub.

### Drizzle, not Prisma

Prisma's standard query engine is a Rust binary (~40MB). Even with the Neon adapter (`@prisma/adapter-neon`), the binary is still included unless explicitly excluded. Drizzle is pure TypeScript — zero binary, smaller Lambda bundle, better esbuild tree-shaking. Both have equivalent developer experience for standard CRUD.

### One Lambda per endpoint, not monolith

A monolithic Lambda (one function handles all routes via a switch) is simpler to deploy but mixes all logs into one stream, prevents per-route IAM scoping, and can't be tuned independently. With CDK, per-endpoint Lambdas cost no extra effort — each is 5 lines of CDK. The per-function overhead (extra CloudFormation resources) is negligible for <50 routes.

### SQS for click tracking, not in-process

Fire-and-forget `.then()` in a Lambda is unreliable — if the Lambda times out or cold-starts, the background promise is killed. SQS provides guaranteed delivery (at-least-once), automatic retries, and batching. The consumer Lambda can process 10 clicks in one invocation instead of 10 separate DB writes.

---

## API documentation

**This project does not currently generate an OpenAPI spec.** Below are the two most practical options for adding it.

### Option A — tsoa (TypeScript to OpenAPI, recommended)

tsoa generates an OpenAPI 3.0 spec and route registration from TypeScript decorators. Works well with the existing handler/service split.

```typescript
// src/modules/links/links.controller.ts
import { Controller, Post, Body, Route, Tags, Security } from "tsoa";

@Route("api/links")
@Tags("Links")
export class LinksController extends Controller {
  @Post()
  @Security("bearerAuth")
  async createLink(@Body() body: CreateLinkRequest): Promise<LinkResponse> { ... }
}
```

Run `tsoa spec-and-routes` to generate `openapi.json` and a routes file. Serve the spec from a Lambda or host it on S3.

### Option B — Manual OpenAPI spec with Swagger UI Lambda

Define the spec in `openapi.yaml`, serve it from a dedicated Lambda:

```typescript
// src/modules/docs/handler.ts
import swaggerUi from "swagger-ui-dist";
import spec from "../../openapi.yaml";

export const handler = async () => ({
  statusCode: 200,
  headers: { "Content-Type": "text/html" },
  body: swaggerHtml(spec),
});
```

Register at `GET /docs` in the CDK construct.

### Current endpoint reference

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | /api/auth/signup | — | `{ username, email, password }` | `{ user, accessToken }` 201 |
| POST | /api/auth/login | — | `{ email, password }` | `{ user, accessToken }` 200 |
| GET | /api/auth/me | Bearer | — | `UserResponse` 200 |
| GET | /api/auth/google | — | — | 302 → Google |
| GET | /api/auth/google/callback | — | `?code=` | 302 → frontend |
| GET | /api/links | Bearer | — | `LinkResponse[]` 200 |
| POST | /api/links | Bearer (optional) | `{ url, customCode?, isPublic?, isPasswordProtected?, password? }` | `LinkResponse` 201 |
| PUT | /api/links/{id} | Bearer | `{ title?, isPublic?, isActive?, isPasswordProtected?, password? }` | `LinkResponse` 200 |
| DELETE | /api/links/{id} | Bearer | — | 204 |
| GET | /api/links/code/{shortCode} | — | — | `LinkResponse` 200 |
| POST | /api/links/code/{shortCode} | — | `{ password }` | `boolean` 200 |
| POST | /api/links/code/{shortCode}/click | — | — | 200 |
| GET | /api/public/{username} | — | — | `UserResponse` 200 |
| GET | /api/public/{username}/links | — | — | `LinkResponse[]` 200 |
| GET | /health | — | — | `{ status }` 200 |
| GET | /health/live | — | — | `{ status, uptime }` 200 |
| GET | /health/ready | — | — | `{ status, checks }` 200/503 |

**Error shape** (all errors):
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

Error codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `NOT_IMPLEMENTED` (501), `INTERNAL_ERROR` (500).

---

## Extending with new AWS patterns

### Standalone ECS service

Use ECS Fargate when you need: a long-running HTTP server, WebSockets, or a process that maintains in-memory state between requests.

**CDK pattern:**

```typescript
import { Cluster, FargateTaskDefinition, FargateService, ContainerImage } from "aws-cdk-lib/aws-ecs";
import { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Vpc } from "aws-cdk-lib/aws-ec2";

// In your stack
const vpc = new Vpc(this, "Vpc", { maxAzs: 2 });

const cluster = new Cluster(this, "Cluster", { vpc });

const taskDef = new FargateTaskDefinition(this, "TaskDef", {
  memoryLimitMiB: 512,
  cpu: 256,
});

taskDef.addContainer("AppContainer", {
  image: ContainerImage.fromAsset("./app"),  // builds from Dockerfile
  portMappings: [{ containerPort: 3000 }],
  environment: { DATABASE_URL: "..." },
  logging: LogDriver.awsLogs({ streamPrefix: "app" }),
});

const service = new FargateService(this, "Service", {
  cluster,
  taskDefinition: taskDef,
  desiredCount: 2,
  assignPublicIp: false,
});

const alb = new ApplicationLoadBalancer(this, "ALB", { vpc, internetFacing: true });
const listener = alb.addListener("Listener", { port: 80 });
listener.addTargets("ECS", { port: 80, targets: [service] });
```

**When to use vs Lambda:**
- Lambda: request/response APIs, burst traffic, infrequent invocations
- ECS: sustained high-throughput, WebSockets, long-running background daemons, anything needing >15 minutes

---

### Lambda → ECS Fargate (long-running tasks)

Common pattern at work: an API Lambda receives a request, starts an ECS Fargate task to do heavy lifting (ML inference, report generation, video processing), and returns immediately. The Fargate task writes results to S3/DB and stops itself.

**Why ECS instead of a longer Lambda:** Lambda max timeout is 15 minutes. Fargate tasks can run for hours and have configurable vCPU/memory (up to 16 vCPU / 120 GB RAM).

**CDK pattern:**

```typescript
import { TaskDefinition, FargateTaskDefinition, ContainerImage, Cluster } from "aws-cdk-lib/aws-ecs";
import { EcsRunTask, EcsFargateLaunchTarget } from "aws-cdk-lib/aws-stepfunctions-tasks";

// Define the Fargate task (no service — run-once task)
const taskDef = new FargateTaskDefinition(this, "WorkerTaskDef", {
  memoryLimitMiB: 4096,
  cpu: 2048,
});

taskDef.addContainer("Worker", {
  image: ContainerImage.fromAsset("./worker"),
  environment: { DATABASE_URL: "..." },
  logging: LogDriver.awsLogs({ streamPrefix: "worker" }),
});

// Grant the trigger Lambda permission to run this task
taskDef.grantRun(triggerLambdaRole);
```

**Trigger Lambda:**

```typescript
import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";

const ecs = new ECSClient({});

export const handler = async (event: APIGatewayProxyEventV2) => {
  const { jobId } = JSON.parse(event.body ?? "{}");

  await ecs.send(new RunTaskCommand({
    cluster: process.env.ECS_CLUSTER_ARN,
    taskDefinition: process.env.TASK_DEF_ARN,
    launchType: "FARGATE",
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: process.env.SUBNET_IDS!.split(","),
        securityGroups: [process.env.SECURITY_GROUP_ID!],
        assignPublicIp: "ENABLED",
      },
    },
    overrides: {
      containerOverrides: [{
        name: "Worker",
        environment: [{ name: "JOB_ID", value: jobId }],
      }],
    },
  }));

  return ok({ message: "Job started", jobId });
};
```

**Self-stopping:** Fargate tasks automatically stop when the container process exits (exit code 0). The worker just runs its logic and returns — no explicit stop call needed.

---

### SQS patterns

**Standard queue (what this project uses):**
- At-least-once delivery
- Out-of-order messages possible
- Batch processing (up to 10,000 messages per batch)
- Use for: fire-and-forget side effects, email sending, analytics events

**FIFO queue:**
- Exactly-once delivery
- Strict ordering within a message group
- Lower throughput (3,000 msg/s with batching)
- Use for: bank transactions, order processing, anything where duplicates are harmful

**CDK pattern for FIFO:**

```typescript
import { Queue, QueueType } from "aws-cdk-lib/aws-sqs";

const fifoQueue = new Queue(this, "OrderQueue", {
  queueName: "orders.fifo",       // .fifo suffix required
  fifo: true,
  contentBasedDeduplication: true,
});
```

**Dead Letter Queue (DLQ):**

Always add a DLQ for production SQS. Without it, failed messages are retried indefinitely then discarded.

```typescript
const dlq = new Queue(this, "ClickDlq", {
  retentionPeriod: Duration.days(14),
});

const clickQueue = new Queue(this, "ClickEventsQueue", {
  deadLetterQueue: {
    queue: dlq,
    maxReceiveCount: 3,   // after 3 failed attempts, move to DLQ
  },
});
```

Alert on DLQ depth with a CloudWatch alarm to know when messages are failing.

---

### Step Functions

Use Step Functions when you have multi-step workflows that need: branching logic, retries with backoff, parallel execution, human approval steps, or visibility into each step's state.

**Common use case:** a multi-stage data pipeline where each stage is a Lambda.

```typescript
import { StateMachine, Chain, Wait, WaitTime, Choice, Condition } from "aws-cdk-lib/aws-stepfunctions";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";

const validateStep = new LambdaInvoke(this, "Validate", {
  lambdaFunction: validateFn,
  outputPath: "$.Payload",
});

const processStep = new LambdaInvoke(this, "Process", {
  lambdaFunction: processFn,
  outputPath: "$.Payload",
  retryOnServiceExceptions: true,  // auto-retry on Lambda throttle
});

const notifyStep = new LambdaInvoke(this, "Notify", {
  lambdaFunction: notifyFn,
});

const chain = Chain
  .start(validateStep)
  .next(new Choice(this, "Valid?")
    .when(Condition.stringEquals("$.status", "ok"), processStep.next(notifyStep))
    .otherwise(new Fail(this, "Rejected", { cause: "Validation failed" })));

new StateMachine(this, "Pipeline", {
  definition: chain,
  timeout: Duration.hours(1),
});
```

**Express Workflows** (synchronous, up to 5 minutes, lower cost) vs **Standard Workflows** (asynchronous, up to 1 year, exact-once). Use Express for request/response APIs that need orchestration, Standard for long-running business processes.

---

### Lambda → Lambda (async)

When a task takes 5–14 minutes (too long for a request but doesn't justify Fargate), invoke a second Lambda asynchronously.

```typescript
import { InvokeCommand, InvocationType, LambdaClient } from "@aws-sdk/client-lambda";

const lambda = new LambdaClient({});

// In the API Lambda
await lambda.send(new InvokeCommand({
  FunctionName: process.env.WORKER_FUNCTION_NAME,
  InvocationType: "Event",           // async — returns immediately
  Payload: JSON.stringify({ jobId }),
}));

return ok({ message: "Processing started" });
```

**Grant in CDK:**

```typescript
workerFn.grantInvoke(apiLambda);
apiLambda.addEnvironment("WORKER_FUNCTION_NAME", workerFn.functionName);
```

**Tradeoffs vs SQS:**
- Lambda → Lambda direct: simpler, no queue infrastructure, but no retry on failure (unless you handle it manually), max payload 256KB
- SQS → Lambda: automatic retry, DLQ, larger payloads, batching, better for high-volume fan-out

Use direct async invocation for one-off background tasks. Use SQS when you need reliability guarantees or high volume.

---

### DynamoDB

Use DynamoDB instead of (or alongside) Postgres when you need: single-digit millisecond reads at any scale, automatic scaling with zero ops, or a key-value/document store with a well-defined access pattern.

**CDK:**

```typescript
import { Table, AttributeType, BillingMode } from "aws-cdk-lib/aws-dynamodb";

const table = new Table(this, "Sessions", {
  tableName: "lnkshrtr-sessions",
  partitionKey: { name: "userId", type: AttributeType.STRING },
  sortKey: { name: "createdAt", type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,    // on-demand, no capacity planning
  timeToLiveAttribute: "expiresAt",            // automatic TTL-based deletion
});

table.grantReadWriteData(myLambda);
myLambda.addEnvironment("SESSIONS_TABLE", table.tableName);
```

**Access pattern:**

```typescript
import { DynamoDBClient, PutItemCommand, GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Put
await ddb.send(new PutCommand({
  TableName: process.env.SESSIONS_TABLE,
  Item: { userId, sessionId, createdAt: new Date().toISOString(), expiresAt: Math.floor(Date.now() / 1000) + 86400 },
}));

// Query all sessions for a user
await ddb.send(new QueryCommand({
  TableName: process.env.SESSIONS_TABLE,
  KeyConditionExpression: "userId = :uid",
  ExpressionAttributeValues: { ":uid": { S: userId } },
}));
```

**When not to use DynamoDB:** complex joins, ad-hoc queries, analytics, or when your access patterns aren't fully known upfront. Postgres wins for relational data.

---

### ElastiCache (Redis/Valkey)

Use ElastiCache when: you need sub-millisecond cache latency, Pub/Sub, or Lua scripting — and you already have a VPC.

**Tradeoff vs Upstash:** ElastiCache requires VPC. Lambda in VPC adds ~100ms cold start and requires NAT Gateway (~$32/month) for internet access. Only worth it if you have existing VPC infrastructure or genuinely need <5ms cache latency.

**CDK:**

```typescript
import { CfnReplicationGroup, CfnSubnetGroup } from "aws-cdk-lib/aws-elasticache";
import { Vpc, SecurityGroup, Port } from "aws-cdk-lib/aws-ec2";

const vpc = new Vpc(this, "Vpc", { maxAzs: 2 });

const cacheSubnetGroup = new CfnSubnetGroup(this, "CacheSubnets", {
  description: "ElastiCache subnet group",
  subnetIds: vpc.privateSubnets.map(s => s.subnetId),
});

const cacheSg = new SecurityGroup(this, "CacheSg", { vpc });

// Allow Lambda SG to connect
cacheSg.addIngressRule(lambdaSg, Port.tcp(6379));

const cache = new CfnReplicationGroup(this, "Cache", {
  replicationGroupDescription: "lnkshrtr-cache",
  cacheNodeType: "cache.t4g.micro",
  engine: "valkey",                  // Valkey is the Redis-compatible OSS fork
  numCacheClusters: 2,               // primary + replica
  cacheSubnetGroupName: cacheSubnetGroup.ref,
  securityGroupIds: [cacheSg.securityGroupId],
  atRestEncryptionEnabled: true,
  transitEncryptionEnabled: true,
});
```

**Connecting from Lambda (also in VPC):**

```typescript
import { Redis } from "ioredis";

// Module-level — reused across warm invocations
const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: 6379,
  tls: {},
  lazyConnect: true,
});

export const handler = async () => {
  await redis.connect();
  const value = await redis.get("key");
  // ...
};
```

---

## CloudWatch and observability

### What Lambda logs look like

Every Lambda invocation produces at minimum:

```
INIT_START Runtime Version: nodejs:22.v78    ← cold start only
START RequestId: abc-123 Version: $LATEST
<your log output here>
END RequestId: abc-123
REPORT RequestId: abc-123  Duration: 45.12 ms  Billed Duration: 46 ms  Memory Size: 256 MB  Max Memory Used: 89 MB  Init Duration: 312.45 ms
```

`Init Duration` only appears on cold starts. Watch this number — it represents the time before your code runs. Typical values: 200–400ms for this project (small bundle + no VPC).

Your application logs appear between `START` and `END`. Since Winston outputs JSON, each line is one JSON object:

```
START RequestId: abc-123 Version: $LATEST
{"level":"info","message":"User registered","userId":"xyz","timestamp":"2026-05-23T22:38:00.000Z"}
END RequestId: abc-123
REPORT RequestId: abc-123  Duration: 1234.56 ms  ...
```

### Log groups per Lambda

Each Lambda has its own log group: `/aws/lambda/<function-name>`. With per-endpoint Lambdas, you can filter CloudWatch to just the log group for the route you're debugging — no noise from other routes.

### CloudWatch Logs Insights queries

**All errors in the last hour across all route Lambdas:**

```
fields @timestamp, @message, @logStream
| filter @message like /"level":"error"/
| sort @timestamp desc
| limit 100
```

**Slow invocations (>1s) by route:**

```
filter @type = "REPORT"
| stats avg(@duration), max(@duration), count() by bin(5min)
| sort @duration desc
```

**Cold start frequency:**

```
filter @type = "REPORT" and @initDuration > 0
| stats count() as coldStarts, avg(@initDuration) as avgInitMs by bin(1h)
```

**Find all requests for a specific user:**

```
fields @timestamp, @message
| filter @message like /"userId":"<id>"/
| sort @timestamp asc
```

### Adding X-Ray tracing (recommended for production)

X-Ray traces the full request lifecycle — API GW → authorizer → Lambda → DB call — giving you a waterfall view of where latency is.

```typescript
// infra/lib/constructs/lambda-function.ts
import { Tracing } from "aws-cdk-lib/aws-lambda";

super(scope, id, {
  tracing: Tracing.ACTIVE,  // add this
  // ...
});
```

```typescript
// shared/db/index.ts — wrap Neon client with X-Ray
import * as AWSXRay from "aws-xray-sdk-core";
const neonWithTracing = AWSXRay.captureHTTPsGlobal(require("http"), true);
```

### API Gateway access logs

Enable to log every request at the API GW level (before it hits Lambda). Useful for debugging CORS issues, 429 rate limits, and authorizer rejections.

```typescript
// infra/lib/stacks/lnkshrtr-stack.ts
import { LogGroup } from "aws-cdk-lib/aws-logs";

const accessLogGroup = new LogGroup(this, "AccessLogs", {
  retention: RetentionDays.ONE_WEEK,
});

const api = new HttpApi(this, "HttpApi", {
  // ...
});

const stage = api.defaultStage?.node.defaultChild as CfnStage;
stage.accessLogSettings = {
  destinationArn: accessLogGroup.logGroupArn,
  format: JSON.stringify({
    requestId: "$context.requestId",
    routeKey: "$context.routeKey",
    status: "$context.status",
    responseLatency: "$context.responseLatency",
    integrationLatency: "$context.integrationLatency",
    authorizerLatency: "$context.authorizer.latency",
    ip: "$context.identity.sourceIp",
    userAgent: "$context.identity.userAgent",
  }),
};
```
