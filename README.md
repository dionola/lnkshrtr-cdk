# lnkshrtr — CDK (AWS Lambda + API Gateway)

Serverless implementation using AWS Lambda, API Gateway HTTP API v2, Neon (serverless Postgres), and Upstash Redis. Infrastructure defined with AWS CDK.

> **Testing:** Integration tests run against a local Postgres database. The `scripts/test-endpoint.ts` CLI is a separate smoke-test that runs against a live deployed URL.

---

## Architecture

```
Client
  │
  ▼
┌─────────────────────────────────────────────────────┐
│  API Gateway HTTP API v2                            │
│                                                     │
│  Public routes          Protected routes            │
│  (no authorizer)        (Lambda Authorizer)         │
│                              │                      │
│                    ┌─────────▼──────────┐           │
│                    │  Authorizer Lambda │           │
│                    │  • verifies JWT    │           │
│                    │  • DB user lookup  │           │
│                    │  • cacheTTL = 0    │           │
│                    └────────────────────┘           │
└──────┬──────────────────────┬───────────────────────┘
       │                      │
       ▼                      ▼
┌─────────────┐      ┌─────────────────┐
│ Public      │      │ Auth / Links /  │
│ Lambda      │      │ Health Lambda   │
└──────┬──────┘      └────────┬────────┘
       │                      │
       │     ┌────────────────┘
       │     │
       ▼     ▼
┌─────────────────┐     ┌──────────────────┐
│  Neon (HTTP)    │     │  Upstash Redis   │
│  Serverless     │     │  (HTTP)          │
│  Postgres       │     │  300s TTL cache  │
└─────────────────┘     └──────────────────┘

Click tracking (async):

Links Lambda
  │  POST /api/links/code/{code}/click
  │  sends { shortCode } to SQS
  ▼
┌─────────────────┐
│  SQS Queue      │
│  ClickEvents    │
└────────┬────────┘
         │  batch=10
         ▼
┌─────────────────────────┐
│  Click Consumer Lambda  │
│  • visits + 1 (SQL)     │
│  • invalidate cache     │
└─────────────────────────┘
```

### CDK stacks

| Stack | Contents |
|---|---|
| `LnkshrtrShared` | HttpApi, SQS queue, Lambda Authorizer |
| `LnkshrtrApi` | Auth, Links, Public, Health Lambda functions + routes |

### Route → auth posture

| Method | Path | Auth |
|---|---|---|
| POST | /api/auth/signup | none |
| POST | /api/auth/login | none |
| GET | /api/auth/me | JWT authorizer |
| GET | /api/auth/google | none |
| GET | /api/auth/google/callback | none |
| GET | /api/links | JWT authorizer |
| POST | /api/links | none (reads token inline if present) |
| PUT | /api/links/{id} | JWT authorizer |
| DELETE | /api/links/{id} | JWT authorizer |
| GET | /api/links/code/{shortCode} | none |
| POST | /api/links/code/{shortCode} | none (password verify) |
| POST | /api/links/code/{shortCode}/click | none → SQS |
| GET | /api/public/{username} | none |
| GET | /api/public/{username}/links | none |
| GET | /health | none |
| GET | /health/live | none |
| GET | /health/ready | none |

---

## Prerequisites

- Node.js 22+
- AWS CLI configured (`aws configure`)
- AWS CDK CLI (`npm i -g aws-cdk`)
- A [Neon](https://neon.tech) project (free tier works)
- An [Upstash](https://upstash.com) Redis database (free tier works)

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env`:

```bash
# Neon — copy the "pooled" connection string from the Neon dashboard
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/lnkshrtr?sslmode=require

# Upstash — copy from the Upstash console REST API section
UPSTASH_REDIS_URL=https://xxx.upstash.io
UPSTASH_REDIS_TOKEN=xxx

# Auth
JWT_SECRET=your-secret-at-least-32-chars
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=10

# Frontend (used for CORS and OAuth redirect)
FRONTEND_URL=http://localhost:5173

# Google OAuth (optional — leave blank to disable)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=https://<api-id>.execute-api.<region>.amazonaws.com/api/auth/google/callback

# CDK
CDK_DEFAULT_ACCOUNT=123456789012
CDK_DEFAULT_REGION=us-east-1
```

### 3. Run database migrations

This pushes the Drizzle schema to your Neon database.

```bash
npm run db:generate   # generates SQL from schema
npm run db:migrate    # applies migrations to Neon
```

To inspect data:

```bash
npm run db:studio
```

### 4. Bootstrap CDK (first deploy only)

```bash
cdk bootstrap aws://ACCOUNT_ID/REGION
```

### 5. Deploy

```bash
npm run deploy
# or deploy a single stack:
npm run deploy:api
```

CDK will output the API Gateway URL when the deploy completes:

```
LnkshrtrShared.HttpApiUrl = https://<api-id>.execute-api.<region>.amazonaws.com
```

---

## Tests

Integration tests invoke the Lambda handlers directly (no HTTP server) against a local Postgres database. Cache (Upstash) and SQS are mocked. Requires a local Postgres instance.

```bash
# Create the test database (one-time)
createdb lnkshrtr_cdk_test

# Run all tests
npm test

# With coverage
npm run test:coverage
```

To use a different test database URL:

```bash
TEST_DATABASE_URL=postgresql://... npm test
```

Test suites:
- `authorizer.test.ts` — JWT verification + DB user lookup
- `auth.test.ts` — signup, login, me, Google OAuth
- `links.test.ts` — all link CRUD + password verify + click (SQS mocked)
- `links.consumer.test.ts` — SQS consumer visit increment
- `public.test.ts` — public profile + public links

---

## Smoke tests

`scripts/test-endpoint.ts` runs a sequence of HTTP requests against a live URL and reports `PASS`/`FAIL` per route. It stores `accessToken`, `linkId`, and `shortCode` in `.test-session` between runs.

```bash
# Run all suites against a deployed URL
npx tsx scripts/test-endpoint.ts all --url https://<api-id>.execute-api.<region>.amazonaws.com

# Run a single suite
npx tsx scripts/test-endpoint.ts auth --url https://...
npx tsx scripts/test-endpoint.ts links --url https://...
npx tsx scripts/test-endpoint.ts public --url https://...
npx tsx scripts/test-endpoint.ts health --url https://...
```

Fixtures are in `scripts/fixtures/`. Edit `auth/register.json` to change the test user credentials.

---

## Project structure

```
cdk/
├── drizzle/
│   └── migrations/          # generated by drizzle-kit
├── infra/
│   ├── bin/
│   │   └── app.ts           # CDK entry point — instantiates stacks
│   └── lib/
│       ├── constructs/
│       │   ├── lambda-function.ts   # NodejsFunction wrapper (runtime, bundling)
│       │   └── api-route.ts         # addRoute helper
│       └── stacks/
│           ├── shared-stack.ts      # HttpApi, SQS queue, Lambda Authorizer
│           └── api-stack.ts         # assembles all module constructs
├── scripts/
│   ├── test-endpoint.ts     # smoke-test CLI
│   └── fixtures/            # request bodies per suite
├── shared/
│   ├── db/                  # Drizzle + Neon HTTP client + schema
│   ├── logger/              # Winston (JSON only, no colorize)
│   ├── types/               # shared response types
│   └── utils/               # cache, errors, jwt, response, short-code
└── src/
    ├── authorizer/          # JWT Lambda Authorizer
    └── modules/
        ├── auth/            # signup, login, me, Google OAuth
        ├── health/          # /health, /health/live, /health/ready
        ├── links/           # CRUD + click tracking via SQS
        └── public/          # public profile + links by username
```
