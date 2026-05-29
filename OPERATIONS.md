# Operations Guide — lnkshrtr CDK

Practical reference for running, changing, and maintaining the serverless deployment.

---

## Table of Contents

1. [New device setup](#new-device-setup)
2. [Deploying](#deploying)
3. [How the AWS pieces fit together](#how-the-aws-pieces-fit-together)
4. [Adding a new endpoint](#adding-a-new-endpoint)
5. [Common infrastructure changes](#common-infrastructure-changes)
6. [CI/CD](#cicd)
7. [Testing](#testing)
8. [Logging](#logging)
9. [Features — present and missing](#features--present-and-missing)
10. [CloudWatch quick links](#cloudwatch-quick-links)

---

## New device setup

### Prerequisites

```bash
# Node.js 22+
node -v

# AWS CLI
brew install awscli        # macOS
aws configure              # enter Access Key, Secret, region: ap-southeast-1, output: json

# CDK CLI (global)
npm install -g aws-cdk

# Verify
aws sts get-caller-identity
cdk --version
```

### Clone and install

```bash
git clone <repo>
cd server/cdk
npm install
```

### Environment

```bash
cp .env.example .env
```

Fill in `.env` — the values for this project are in the existing prod Lambda environment:

```bash
aws lambda get-function-configuration \
  --function-name lnkshrtr-api-prod-api \
  --region ap-southeast-1 \
  --query 'Environment.Variables'
```

Required keys: `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, `CDK_DEFAULT_ACCOUNT`, `CDK_DEFAULT_REGION`.

### Local test database (for integration tests)

```bash
createdb lnkshrtr_cdk_test
npm run db:push:test        # push schema to test DB
npm test                    # run all tests
```

If `db:push:test` is not in package.json yet, run:

```bash
DATABASE_URL=postgresql://$(whoami)@localhost:5432/lnkshrtr_cdk_test npx drizzle-kit push
```

### First deploy (bootstrap only needed once per account/region)

```bash
cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/ap-southeast-1
STAGE=prod npm run deploy
```

---

## Deploying

### Stages

Each stage is a completely separate CloudFormation stack with its own Lambdas, API Gateway, and SQS queue. Set `STAGE` before every deploy. If unset, defaults to `prod`.

```bash
# Production
STAGE=prod npx cdk deploy LnkshrtrCdk-prod --require-approval never

# Staging
STAGE=staging npx cdk deploy LnkshrtrCdk-staging --require-approval never

# Dev
STAGE=dev npx cdk deploy LnkshrtrCdk-dev --require-approval never
```

Each stage gets isolated resources named `lnkshrtr-{stage}-*`:
- Lambda functions: `lnkshrtr-prod-auth-signup`, `lnkshrtr-dev-auth-signup`, etc.
- CloudWatch log groups: `/aws/lambda/lnkshrtr-{stage}-{name}`
- SQS queue: `lnkshrtr-{stage}-click-events`
- Separate API Gateway endpoint per stage

Bootstrap is only needed once per account/region. If staging is in the same account and region as prod, you don't need to bootstrap again.

### Full stack deploy vs hotswap

**Full deploy** — use for any infra change (new route, new env var, new Lambda, IAM change):

```bash
STAGE=prod npx cdk deploy LnkshrtrCdk-prod --require-approval never
```

CloudFormation diffs the stack and only updates resources that changed. If only one Lambda's code changed, only that Lambda gets updated — you don't need to do anything special to target it.

**Hotswap** — use for Lambda code-only changes during development. Bypasses CloudFormation entirely and patches the affected Lambdas directly. Takes ~5 seconds instead of ~2 minutes:

```bash
STAGE=dev npx cdk deploy LnkshrtrCdk-dev --hotswap
STAGE=staging npx cdk deploy LnkshrtrCdk-staging --hotswap
```

CDK detects which Lambdas changed automatically from the diff — you don't specify a file or handler. If any infra change is also present (e.g. new env var), CDK falls back to a full CloudFormation update for that resource.

> Do not use `--hotswap` on production. It bypasses CloudFormation state tracking, which can cause drift.

### Checking what will change before deploying

```bash
STAGE=prod npx cdk diff LnkshrtrCdk-prod
```

Shows exactly which resources will be created, updated, or destroyed. Run this before any production deploy.

### Destroying a stage

```bash
STAGE=dev npx cdk destroy LnkshrtrCdk-dev
```

Deletes all AWS resources for that stage. Does not delete CloudWatch log groups (AWS retains those). Does not affect other stages.

---

## How the AWS pieces fit together

### Request lifecycle

```
Internet
  → API Gateway HTTP API v2 (ap-southeast-1)
      → [if protected route] Authorizer Lambda (JWT verify + DB user lookup)
          → returns { isAuthorized: true, context: { userId, username, email } }
      → Route Lambda (e.g. LinksCreateLinkFn)
          → reads event.requestContext.authorizer.lambda.userId (for protected)
          → reads event.headers.authorization (optional auth, e.g. POST /api/links)
          → Neon HTTP (serverless Postgres) — one HTTP call per query
          → Upstash Redis HTTP (optional cache, 300s TTL)
          → returns APIGatewayProxyResultV2
```

### One Lambda per endpoint

Each API route has its own Lambda function (not a monolith). This means:

- **Separate CloudWatch log group** per route — searching `POST /api/auth/signup` logs doesn't mix with `GET /api/links` logs
- **Separate IAM role** per function — principle of least privilege
- **Independent memory/timeout** tuning per route
- **Cold starts are route-specific** — a spike on one route doesn't affect another

Tradeoff: more CloudFormation resources (1 Lambda + 1 IAM role + 1 integration per route). For 17 routes that's ~85 resources — well within the 500 resource limit per stack.

### CDK stack layout

Single stack: `LnkshrtrCdk` (in `infra/lib/stacks/lnkshrtr-stack.ts`)

Everything lives in one stack to avoid cross-stack circular references (API GW integrations must be in the same stack as the HTTP API).

```
LnkshrtrCdk
├── HttpApi (API Gateway HTTP API v2)
├── AuthorizerConstruct
│   └── AuthorizerFn (Lambda)
│   └── JwtAuthorizer (HttpLambdaAuthorizer)
├── ClickEventsQueue (SQS)
├── HealthConstruct
│   ├── HealthFn, LiveFn, ReadyFn (3 Lambdas)
├── AuthConstruct
│   ├── SignupFn, LoginFn, MeFn, GoogleFn, GoogleCallbackFn (5 Lambdas)
├── LinksConstruct
│   ├── GetLinksFn, CreateLinkFn, UpdateLinkFn, DeleteLinkFn (4 Lambdas)
│   ├── GetLinkByCodeFn, VerifyPasswordFn, RecordClickFn (3 Lambdas)
│   └── ClickConsumerFn (SQS consumer Lambda)
└── PublicConstruct
    └── PublicProfileFn, PublicLinksFn (2 Lambdas)
```

### Lambda authorizer

The authorizer Lambda (`src/authorizer/handler.ts`) runs before every protected route:

1. Extracts `Authorization: Bearer <token>` header
2. Verifies JWT signature (returns `{ isAuthorized: false }` on failure)
3. Fetches the user from DB to confirm they haven't been deleted
4. Returns `{ isAuthorized: true, context: { userId, username, email } }`

`cacheTtl = 0` — no caching. Every request triggers a fresh DB lookup. This matches Express behavior where deleted users are rejected immediately.

To enable caching (faster, but deleted users stay valid for TTL duration):

```typescript
// src/authorizer/infra/authorizer.construct.ts
resultsCacheTtl: Duration.seconds(300),  // was Duration.seconds(0)
```

### SQS click tracking

`POST /api/links/code/{shortCode}/click` sends `{ shortCode }` to the `ClickEventsQueue` SQS queue. A separate `ClickConsumerFn` Lambda processes the queue in batches of 10, incrementing `visits` in the DB and invalidating the Redis cache. This is fire-and-forget — the API returns 200 immediately without waiting for the DB write.

---

## Adding a new endpoint

Example: `GET /api/links/{id}` — get a single link by ID.

### Step 1 — Add service function

```typescript
// src/modules/links/links.service.ts
export async function getLinkById(event: APIGatewayProxyEventV2) {
  const userId = (event.requestContext as any).authorizer?.lambda?.userId as string;
  const id = event.pathParameters?.id;
  if (!id) throw new AppError(400, "BAD_REQUEST", "Missing link id");

  const link = await linksRepository.findById(id);
  if (!link) throw new AppError(404, "NOT_FOUND", "Link not found");
  if (link.userId !== userId) throw new AppError(403, "FORBIDDEN", "Not your link");

  return ok(toLinkResponse(link));
}
```

### Step 2 — Add repository method (if needed)

```typescript
// src/modules/links/links.repository.ts
async findById(id: string) {
  const [link] = await db.select().from(links).where(eq(links.id, id)).limit(1);
  return link ?? null;
},
```

### Step 3 — Create the handler file

```typescript
// src/modules/links/handlers/get-link-by-id.handler.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { getLinkById } from "../links.service";
import { handleError } from "../../../../shared/utils/response";

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    return await getLinkById(event);
  } catch (err) {
    return handleError(err);
  }
};
```

### Step 4 — Register the route in the construct

```typescript
// src/modules/links/infra/links.construct.ts — inside constructor
const getLinkById = new LambdaFunction(this, "GetLinkByIdFn", {
  entry: path.join(__dirname, "../handlers/get-link-by-id.handler.ts"),
  environment,
});
api.addRoutes({
  path: "/api/links/{id}",
  methods: [HttpMethod.GET],
  integration: new HttpLambdaIntegration("GetLinkByIdIntegration", getLinkById),
  authorizer: jwtAuthorizer,   // omit for public routes
});
```

### Step 5 — Add tests

```typescript
// src/modules/links/__tests__/links.test.ts
describe("GET /api/links/{id}", () => {
  it("returns a link by id", async () => {
    const { user } = await createUserWithToken();
    const link = await createLink({ userId: user.id, shortCode: "gbi001" });

    const res = await getLinkByIdHandler(buildEvent({
      pathParameters: { id: link.id },
      authContext: { userId: user.id },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res).id).toBe(link.id);
  });
});
```

### Step 6 — Deploy

```bash
npm run deploy
```

CDK detects the new Lambda + route, creates them in place — no downtime.

---

## Common infrastructure changes

### Change the custom domain

The CDK stack doesn't currently configure a custom domain (it uses the raw API GW URL). To add one:

1. Create or import a certificate in ACM (must be in the same region for HTTP APIs):

```bash
aws acm request-certificate \
  --domain-name api.lnkshrtr.com \
  --validation-method DNS \
  --region ap-southeast-1
```

2. Add to `lnkshrtr-stack.ts`:

```typescript
import { DomainName, EndpointType } from "aws-cdk-lib/aws-apigatewayv2";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";

const cert = Certificate.fromCertificateArn(this, "Cert", "arn:aws:acm:...");

const domain = new DomainName(this, "DomainName", {
  domainName: "api.lnkshrtr.com",
  certificate: cert,
});

const api = new HttpApi(this, "HttpApi", {
  defaultDomainMapping: { domainName: domain },
  // ... cors config
});
```

3. Add a CNAME/ALIAS in Route 53 pointing `api.lnkshrtr.com` → the API GW domain name output.

### Update CORS allowed origins

```typescript
// infra/lib/stacks/lnkshrtr-stack.ts
corsPreflight: {
  allowOrigins: [e.FRONTEND_URL, "https://staging.lnkshrtr.com"],
  // ...
}
```

Then `npm run deploy`.

### Change Lambda memory or timeout

```typescript
// infra/lib/constructs/lambda-function.ts
super(scope, id, {
  memorySize: 512,           // was 256
  timeout: Duration.seconds(60),  // was 30
  // ...
});
```

To set different values per function, override in the construct:

```typescript
const heavyFn = new LambdaFunction(this, "HeavyFn", {
  entry: "...",
  memorySize: 1024,
  timeout: Duration.seconds(60),
  environment,
});
```

### Add a new environment variable to all Lambdas

Add it to `appEnv` in `infra/bin/app.ts` and pass it into the relevant construct's `environment` block in `lnkshrtr-stack.ts`.

### Switch to API Gateway REST API (v1) from HTTP API (v2)

HTTP API v2 is cheaper and faster. You'd only switch to REST API (v1) for features like: request validation schemas, usage plans, API keys, caching at the GW level, or VPC links to private resources.

If you need to switch:
- Replace `HttpApi` with `RestApi` from `aws-cdk-lib/aws-apigateway`
- Replace `HttpLambdaIntegration` with `LambdaIntegration`
- Replace `HttpLambdaAuthorizer` with `TokenAuthorizer`
- Route event shape changes from `APIGatewayProxyEventV2` to `APIGatewayProxyEvent`

### Upgrade Node.js runtime

```typescript
// infra/lib/constructs/lambda-function.ts
runtime: Runtime.NODEJS_22_X,  // change to NODEJS_24_X when available
```

---

## CI/CD

Yes — serverless CI/CD works well. The key insight: integration tests invoke Lambda handlers directly as functions. No deployed infra is needed to test business logic.

### GitHub Actions recommended setup

**`.github/workflows/pr.yml`** — runs on every PR:

```yaml
name: PR checks
on: [pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: lnkshrtr_cdk_test
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }

      - run: npm ci
        working-directory: server/cdk

      # Validate the CDK template compiles (catches construct errors without deploying)
      - name: CDK synth
        working-directory: server/cdk
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/lnkshrtr_cdk_test
          JWT_SECRET: ci-test-secret-at-least-32-characters-long
          FRONTEND_URL: http://localhost:5173
          CDK_DEFAULT_ACCOUNT: "000000000000"
          CDK_DEFAULT_REGION: ap-southeast-1
        run: npx cdk synth

      # Push schema to test DB
      - name: Push schema
        working-directory: server/cdk
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/lnkshrtr_cdk_test
        run: npx drizzle-kit push

      # Run integration tests
      - name: Test
        working-directory: server/cdk
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/lnkshrtr_cdk_test
          JWT_SECRET: ci-test-secret-at-least-32-characters-long
          BCRYPT_ROUNDS: "1"
        run: npm test
```

**`.github/workflows/deploy.yml`** — two jobs: staging on PR merge to `develop`, prod on merge to `main`:

```yaml
name: Deploy
on:
  push:
    branches: [main, develop]
    paths: ["server/cdk/**"]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-southeast-1

      - run: npm ci
        working-directory: server/cdk

      - name: Set stage
        run: echo "STAGE=${{ github.ref_name == 'main' && 'prod' || 'staging' }}" >> $GITHUB_ENV

      - name: Deploy
        working-directory: server/cdk
        env:
          STAGE: ${{ env.STAGE }}
          DATABASE_URL: ${{ github.ref_name == 'main' && secrets.DATABASE_URL_PROD || secrets.DATABASE_URL_STAGING }}
          JWT_SECRET: ${{ github.ref_name == 'main' && secrets.JWT_SECRET_PROD || secrets.JWT_SECRET_STAGING }}
          FRONTEND_URL: ${{ github.ref_name == 'main' && vars.FRONTEND_URL_PROD || vars.FRONTEND_URL_STAGING }}
          CDK_DEFAULT_ACCOUNT: ${{ secrets.AWS_ACCOUNT_ID }}
          CDK_DEFAULT_REGION: ap-southeast-1
        run: npx cdk deploy LnkshrtrCdk-${{ env.STAGE }} --require-approval never

      - name: Smoke test
        working-directory: server/cdk
        env:
          API_URL: ${{ github.ref_name == 'main' && vars.API_URL_PROD || vars.API_URL_STAGING }}
        run: npx tsx scripts/test-endpoint.ts all --url ${{ env.API_URL }}
```

**GitHub Secrets** (Settings → Secrets): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ACCOUNT_ID`, `DATABASE_URL_PROD`, `DATABASE_URL_STAGING`, `JWT_SECRET_PROD`, `JWT_SECRET_STAGING`

**GitHub Variables** (Settings → Variables): `FRONTEND_URL_PROD`, `FRONTEND_URL_STAGING`, `API_URL_PROD`, `API_URL_STAGING`

### Create a deploy IAM user (least privilege)

Don't use root credentials for CI. Create a deploy user:

```bash
aws iam create-user --user-name lnkshrtr-deploy
aws iam attach-user-policy \
  --user-name lnkshrtr-deploy \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess   # tighten this in prod
aws iam create-access-key --user-name lnkshrtr-deploy
```

---

## Testing

### Run all tests

```bash
npm test
```

### Run a specific test file

```bash
npm test -- auth.test.ts
npm test -- links.test.ts
npm test -- src/__tests__/authorizer.test.ts
```

### Run a specific describe block or test name

```bash
# All tests in a describe block
npm test -- --testNamePattern "POST /api/auth/signup"

# A single test
npm test -- --testNamePattern "registers a new user and returns user"

# A file + pattern
npm test -- auth.test.ts --testNamePattern "returns 409"
```

### Run a specific route handler in isolation

Since each route is its own handler file, you can import and invoke it directly in a one-off script:

```typescript
// scripts/debug-handler.ts
import { handler } from "../src/modules/auth/handlers/signup.handler";

const res = await handler({
  routeKey: "",
  rawPath: "",
  rawQueryString: "",
  headers: {},
  isBase64Encoded: false,
  requestContext: { accountId: "", apiId: "", domainName: "", domainPrefix: "",
    http: { method: "POST", path: "/api/auth/signup", protocol: "HTTP/1.1", sourceIp: "", userAgent: "" },
    requestId: "", routeKey: "", stage: "", time: "", timeEpoch: 0 },
  body: JSON.stringify({ username: "debuguser", email: "debug@example.com", password: "password123" }),
  version: "2.0",
} as any);

console.log(res);
```

```bash
DATABASE_URL=postgresql://... JWT_SECRET=... npx tsx scripts/debug-handler.ts
```

### Watch mode

```bash
npm test -- --watch
```

### Coverage

```bash
npm test -- --coverage
```

### What the tests cover

| File | What it tests |
|---|---|
| `authorizer.test.ts` | JWT verify, DB lookup, expired/malformed/missing tokens |
| `auth.test.ts` | Signup validation, login credentials, `me` endpoint, Google OAuth 501 |
| `links.test.ts` | All 7 link routes — CRUD, passwords, click, ownership checks |
| `links.consumer.test.ts` | SQS batch processing, visit increment, cache invalidation |
| `public.test.ts` | Public profile, public links filtering (private/inactive excluded) |

---

## Logging

### Log levels

The logger (`shared/logger/index.ts`) uses Winston. The default level is `info`. Set the `LOG_LEVEL` environment variable to change it:

```bash
LOG_LEVEL=debug   # all messages
LOG_LEVEL=info    # info, warn, error (default)
LOG_LEVEL=warn    # warn and error only
LOG_LEVEL=error   # errors only
```

To change in Lambda, add `LOG_LEVEL` to the function's environment in `lnkshrtr-stack.ts`, or update it live:

```bash
aws lambda update-function-configuration \
  --function-name LnkshrtrCdk-AuthSignupFn14024791-Pb08uGgYgxIf \
  --environment Variables="{LOG_LEVEL=debug,...existing vars...}" \
  --region ap-southeast-1
```

### Log format

All logs are JSON (no color, no pretty-print — Lambda stdout is CloudWatch). Every log line is one JSON object:

```json
{"level":"info","message":"User registered","userId":"abc123","timestamp":"2026-05-23T22:38:00.000Z"}
{"level":"error","message":"Unhandled error","error":"connection refused","stack":"Error: ...","timestamp":"2026-05-23T22:38:01.000Z"}
{"level":"warn","message":"Authorizer rejected request","error":"jwt expired","timestamp":"2026-05-23T22:38:02.000Z"}
```

### Viewing logs in CloudWatch

**AWS Console:**

Go to CloudWatch → Log Groups → filter by `/aws/lambda/LnkshrtrCdk`.

Each Lambda has its own log group named:
`/aws/lambda/LnkshrtrCdk-{ConstructId}{RandomSuffix}`

**AWS CLI (last 5 minutes of a specific route):**

```bash
# Signup Lambda
aws logs filter-log-events \
  --region ap-southeast-1 \
  --log-group-name "/aws/lambda/LnkshrtrCdk-AuthSignupFn14024791-Pb08uGgYgxIf" \
  --start-time $(($(date +%s) - 300))000 \
  --query 'events[].message' \
  --output text

# Tail live (requires CloudWatch Logs Insights or aws logs tail)
aws logs tail /aws/lambda/LnkshrtrCdk-AuthSignupFn14024791-Pb08uGgYgxIf \
  --follow \
  --region ap-southeast-1
```

**Filter only errors across all Lambdas:**

CloudWatch Logs Insights → select all `/aws/lambda/LnkshrtrCdk*` log groups → run:

```
fields @timestamp, @message
| filter level = "error"
| sort @timestamp desc
| limit 50
```

---

## Features — present and missing

### Present

| Feature | Notes |
|---|---|
| JWT authentication | HS256, `JWT_SECRET` in env, 7d expiry |
| Lambda Authorizer | Per-request DB user lookup, cacheTTL=0 |
| Google OAuth | Manual implementation (no Passport), email-based user lookup |
| Password hashing | bcryptjs, configurable rounds |
| Short code generation | cuid2-based, collision-safe retry loop |
| Custom short codes | User-supplied `customCode` on POST /api/links |
| Password-protected links | bcrypt-hashed, verify endpoint returns bool |
| Public/private links | `isPublic` flag, filtered in public endpoints |
| Active/inactive links | `isActive` flag |
| Visit tracking | Async via SQS → consumer Lambda |
| Redis caching | Upstash HTTP, 300s TTL on link lookups and public profiles |
| Graceful cache degradation | All endpoints work if Upstash is unconfigured |
| Structured JSON logging | Winston, configurable `LOG_LEVEL` |
| Health endpoints | `/health`, `/health/live`, `/health/ready` (DB + Redis ping) |
| Integration tests | 95 tests, local Postgres, SQS + cache mocked |
| Smoke test CLI | `scripts/test-endpoint.ts`, session-threaded, fixture-based |
| 1 Lambda per endpoint | Isolated logs, IAM, memory/timeout per route |

### Missing / not yet implemented

| Feature | Notes |
|---|---|
| **Custom domain** | API is on raw `*.execute-api.*.amazonaws.com`. Needs ACM cert + `DomainName` CDK construct |
| **OpenAPI / Swagger docs** | No spec generated. See [ARCHITECTURE.md](./ARCHITECTURE.md) for options |
| **Request IDs** in responses | Express returns `x-request-id` header; this implementation does not |
| **Rate limiting** | No throttling at API GW or application level. API GW has default 10k RPS limit |
| **DLQ for SQS** | Click queue has no Dead Letter Queue — failed messages are discarded after max retries |
| **API GW access logs** | Lambda logs are present but API GW-level access logs (request/response per call) are not enabled |
| **AWS X-Ray tracing** | Not enabled. Adds latency visibility per segment (authorizer, DB call, cache hit) |
| **Provisioned concurrency** | Cold starts possible on first request. Add to high-traffic routes if p99 latency matters |
| **Upstash REST credentials** | Current setup reads from Redis TCP URL (`rediss://`) — the HTTP client needs a separate REST token from the Upstash console |
| **Refresh tokens** | Single access token, no refresh flow |
| **Email verification** | No email confirmation on signup |
| **`LOG_LEVEL` per Lambda** | All Lambdas share the same level. Could be set individually in the CDK construct |
| **TypeScript strict mode** | `noUnusedLocals/Parameters` disabled in test config. Production build is strict |
| **Pagination** | `GET /api/links` returns all links with no limit |

---

## CloudWatch quick links

Replace `ap-southeast-1` with your region if different.

| Resource | Console link |
|---|---|
| All Lambda log groups | [CloudWatch Log Groups](https://ap-southeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-southeast-1#logsV2:log-groups$3FlogGroupNameFilter$3D%2Faws%2Flambda%2FLnkshrtrCdk) |
| API Gateway | [API Gateway Console](https://ap-southeast-1.console.aws.amazon.com/apigateway/main/apis?region=ap-southeast-1) |
| All Lambda functions | [Lambda Console](https://ap-southeast-1.console.aws.amazon.com/lambda/home?region=ap-southeast-1#/functions?f=LnkshrtrCdk) |
| SQS click queue | [SQS Console](https://ap-southeast-1.console.aws.amazon.com/sqs/v3/home?region=ap-southeast-1#/queues) |
| CloudFormation stack | [CFN Stack](https://ap-southeast-1.console.aws.amazon.com/cloudformation/home?region=ap-southeast-1#/stacks/stackinfo?stackId=LnkshrtrCdk) |

### Individual Lambda log groups (current deployment)

| Route | Log group |
|---|---|
| POST /api/auth/signup | `/aws/lambda/LnkshrtrCdk-AuthSignupFn14024791-Pb08uGgYgxIf` |
| POST /api/auth/login | `/aws/lambda/LnkshrtrCdk-AuthLoginFnD12B18EB-eZGxyg7cDiZY` |
| GET /api/auth/me | `/aws/lambda/LnkshrtrCdk-AuthMeFnE933A11D-bEg2tagbEHE1` |
| Authorizer | `/aws/lambda/LnkshrtrCdk-AuthorizerAuthorizerFnF03B4B1E-4Vb95xLcIjKh` |
| GET /api/links | `/aws/lambda/LnkshrtrCdk-LinksGetLinksFnA50FD7A9-P7H03K7Soo7z` |
| POST /api/links | `/aws/lambda/LnkshrtrCdk-LinksCreateLinkFn349629AF-2JKZtzeeqj79` |
| PUT /api/links/{id} | `/aws/lambda/LnkshrtrCdk-LinksUpdateLinkFn3583F335-7amTEIDm5shk` |
| DELETE /api/links/{id} | `/aws/lambda/LnkshrtrCdk-LinksDeleteLinkFn10754FFF-hyexKpNC7Nj1` |
| GET /api/links/code/{code} | `/aws/lambda/LnkshrtrCdk-LinksGetLinkByCodeFn7B938C4E-zZKSRRVLeo3S` |
| POST .../click | `/aws/lambda/LnkshrtrCdk-LinksRecordClickFn0F230342-W9eMy49e9dzh` |
| Click consumer | `/aws/lambda/LnkshrtrCdk-LinksClickConsumerFn64ED8CEF-TakbdC2To182` |
| GET /api/public/{username} | `/aws/lambda/LnkshrtrCdk-PublicPublicProfileFn19EA73BE-BMcDpYzaiwAl` |
| GET /api/public/{username}/links | `/aws/lambda/LnkshrtrCdk-PublicPublicLinksFnA1D9CDE4-SfZhyWB7C9kF` |
| GET /health/ready | `/aws/lambda/LnkshrtrCdk-HealthReadyFn9E5B1EBD-UYU8mV7Ks6B4` |
