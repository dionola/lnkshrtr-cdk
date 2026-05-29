# Deployment Guide — lnkshrtr CDK

Everything you need to deploy this project, understand what the commands actually do, and set up automated deployments. No prior CDK or CloudFormation knowledge assumed.

---

## Table of Contents

1. [How CDK deployment works](#how-cdk-deployment-works)
2. [One-time setup](#one-time-setup)
3. [Development workflow](#development-workflow)
4. [Staging and production deployment](#staging-and-production-deployment)
5. [Command reference — every flag explained](#command-reference--every-flag-explained)
6. [CI/CD with GitHub Actions](#cicd-with-github-actions)
7. [Managing secrets per stage](#managing-secrets-per-stage)
8. [Troubleshooting](#troubleshooting)

---

## How CDK deployment works

Before running any command, it helps to understand the chain of tools involved.

### The chain: TypeScript → CloudFormation → AWS

```
Your TypeScript code (infra/lib/stacks/)
        ↓  cdk synth
CloudFormation template (JSON describing your AWS resources)
        ↓  cdk deploy
CloudFormation (AWS service that reads the template and creates/updates real resources)
        ↓
Real AWS resources: Lambda functions, API Gateway, SQS queue, IAM roles
```

**CDK (Cloud Development Kit)** is a tool that lets you describe AWS infrastructure in TypeScript. When you run `cdk deploy`, it compiles your TypeScript into a CloudFormation template and sends it to AWS.

**CloudFormation** is AWS's own infrastructure management system. It receives the template, compares it against what's already deployed (the "stack"), and figures out the minimal set of changes needed. It's the thing that actually creates, updates, or deletes your AWS resources.

**A stack** is a named collection of AWS resources that CloudFormation manages together. This project has one stack per stage: `LnkshrtrCdk-prod`, `LnkshrtrCdk-staging`, `LnkshrtrCdk-dev`. Each is completely independent — destroying dev doesn't touch prod.

### What happens when you deploy

1. CDK compiles your TypeScript constructs into a CloudFormation JSON template
2. CDK bundles each Lambda handler with esbuild (minified, ~200KB zip per function)
3. CDK uploads the Lambda zips to an S3 bucket (the "CDK assets bucket", created during bootstrap)
4. CDK sends the CloudFormation template to AWS
5. CloudFormation diffs the template against the current deployed state
6. CloudFormation updates only the resources that changed — if only one Lambda's code changed, only that Lambda gets a new zip

A full deploy of this project (all 19 Lambdas, first time) takes about 3–4 minutes. An update to one Lambda takes about 90 seconds because CloudFormation still goes through its full update cycle.

---

## One-time setup

### Prerequisites

```bash
# Node.js 22+
node -v

# AWS CLI — used to authenticate with AWS
brew install awscli  # macOS
# or: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html

# Verify AWS credentials are configured
aws sts get-caller-identity
# should return: { "Account": "...", "UserId": "...", "Arn": "..." }
```

If `aws sts get-caller-identity` returns an error, run `aws configure` and enter your Access Key ID, Secret Access Key, and default region (`ap-southeast-1`).

### Install dependencies

```bash
cd server/cdk
npm install
```

### Bootstrap (once per AWS account + region)

Before you can deploy for the first time, CDK needs to create some resources in your AWS account that it uses internally — an S3 bucket for Lambda zips and an IAM role for CloudFormation to use.

```bash
npx cdk bootstrap aws://ACCOUNT_ID/REGION

# Example for this project:
npx cdk bootstrap aws://389890955896/ap-southeast-1

# Or let the CLI figure out your account ID:
npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/ap-southeast-1
```

**You only run bootstrap once per account/region combination.** If you're deploying dev, staging, and prod all to the same AWS account and region, one bootstrap covers all three stages. If you're using a separate AWS account for prod (recommended for large teams), you'd bootstrap that account separately.

Bootstrap creates:
- An S3 bucket named `cdk-hnb659fds-assets-{account}-{region}` — stores Lambda zip files
- An IAM role that CloudFormation uses to deploy resources on your behalf

---

## Development workflow

During development you typically don't need to deploy to AWS at all. The integration tests run directly against the Neon dev database and call Lambda handlers as plain TypeScript functions — no Lambda runtime, no API Gateway.

### Local testing (no deploy needed)

```bash
# Run all integration tests against Neon dev database
npm test

# Run tests for a specific module
npx jest auth
npx jest links

# Watch mode — re-runs tests on file save
npx jest --watch
```

Tests don't need AWS credentials. They import the handler function directly and call it. No Lambda, no API Gateway, no deploy.

### Deploying a dev stage to AWS

When you need to test something that requires the actual Lambda environment (cold start behavior, API Gateway routing, SQS processing), deploy a dev stage:

```bash
# Full deploy to dev stage
STAGE=dev npx cdk deploy LnkshrtrCdk-dev --require-approval never

# After the first deploy, use hotswap for faster iteration (explained below)
STAGE=dev npx cdk deploy LnkshrtrCdk-dev --hotswap
```

The dev stage creates a completely separate set of resources from prod (`lnkshrtr-dev-auth-signup`, etc.). It has its own API Gateway endpoint. You can destroy it entirely when done without affecting anything else.

### Hotswap — fast iteration during development

A normal `cdk deploy` goes through CloudFormation, which takes ~90 seconds even for a one-line Lambda change. Hotswap bypasses CloudFormation and patches the Lambda directly:

```bash
STAGE=dev npx cdk deploy LnkshrtrCdk-dev --hotswap
```

With hotswap:
- CDK diffs your code against what's deployed
- For Lambda code changes: uploads the new zip directly to Lambda (~5 seconds)
- For infra changes (new route, new env var, IAM): falls back to CloudFormation automatically for those resources

**Use hotswap only on dev and staging, never on production.** Hotswap bypasses CloudFormation's state tracking, which can cause the CloudFormation state to drift from reality. On prod, always use a full deploy.

### Checking what will change before deploying

```bash
STAGE=prod npx cdk diff LnkshrtrCdk-prod
```

Shows a diff of every resource that would be created, updated, or destroyed. Run this before any production deploy to avoid surprises. Output looks like:

```
Stack LnkshrtrCdk-prod
Resources
[~] AWS::Lambda::Function Auth/SignupFn lnkshrtr-prod-auth-signup
 └─ [~] Code
     └─ [~] .S3Key
         ├─ [-] abc123.zip
         └─ [+] def456.zip
```

This means only the signup Lambda's code would change.

---

## Staging and production deployment

### Stage concept

Each stage (`dev`, `staging`, `prod`) is a **completely separate** CloudFormation stack. Separate Lambdas, separate API Gateway, separate SQS queue, separate IAM roles. They share nothing at the AWS infrastructure level (they can share a database if you configure the same `DATABASE_URL`, but the AWS resources are isolated).

| Resource | Dev | Staging | Prod |
|---|---|---|---|
| Stack name | `LnkshrtrCdk-dev` | `LnkshrtrCdk-staging` | `LnkshrtrCdk-prod` |
| Lambda names | `lnkshrtr-dev-*` | `lnkshrtr-staging-*` | `lnkshrtr-prod-*` |
| SQS queue | `lnkshrtr-dev-click-events` | `lnkshrtr-staging-click-events` | `lnkshrtr-prod-click-events` |
| API endpoint | separate URL | separate URL | separate URL |
| Docs | `{dev-url}/docs` | `{staging-url}/docs` | `{prod-url}/docs` |

### Deploying to staging

```bash
STAGE=staging npx cdk deploy LnkshrtrCdk-staging --require-approval never
```

### Deploying to production

```bash
# 1. See what will change
STAGE=prod npx cdk diff LnkshrtrCdk-prod

# 2. Deploy
STAGE=prod npx cdk deploy LnkshrtrCdk-prod --require-approval never

# 3. Smoke test against the live URL
npx tsx scripts/test-endpoint.ts all --url https://YOUR_API_ENDPOINT
```

The outputs printed at the end of a successful deploy tell you the URLs:

```
Outputs:
LnkshrtrCdk-prod.ApiEndpoint   = https://24z8wa1hga.execute-api.ap-southeast-1.amazonaws.com
LnkshrtrCdk-prod.DocsUrl       = https://24z8wa1hga.execute-api.ap-southeast-1.amazonaws.com/docs
LnkshrtrCdk-prod.CloudWatchLogs = https://ap-southeast-1.console.aws.amazon.com/...
```

### Environment variables per stage

Create a `.env.staging` and `.env.prod` file (never commit these):

```bash
# .env.prod
DATABASE_URL=postgresql://...neon.tech/lnkshrtr?sslmode=require
JWT_SECRET=your-prod-secret-64-chars-min
FRONTEND_URL=https://yourapp.com
STAGE=prod
CDK_DEFAULT_ACCOUNT=389890955896
CDK_DEFAULT_REGION=ap-southeast-1
```

Load the right file when deploying:

```bash
# Production
set -a && source .env.prod && set +a
npx cdk deploy LnkshrtrCdk-prod --require-approval never

# Staging
set -a && source .env.staging && set +a
npx cdk deploy LnkshrtrCdk-staging --require-approval never
```

### Tearing down a stage

```bash
STAGE=dev npx cdk destroy LnkshrtrCdk-dev
```

Deletes every AWS resource in that stack. CloudWatch log groups are retained by default (AWS never auto-deletes logs). Does not affect other stages.

---

## Command reference — every flag explained

### `cdk deploy STACK_NAME`

Deploys (or updates) the named CloudFormation stack. The stack name must match what's in `infra/bin/app.ts` — for this project it's always `LnkshrtrCdk-{stage}`.

```bash
STAGE=prod npx cdk deploy LnkshrtrCdk-prod
```

Without `STACK_NAME`, CDK would deploy all stacks (this project only has one per stage, so it doesn't matter much here).

---

### `--require-approval never`

By default, CDK pauses and asks you to manually approve **security-sensitive changes** before applying them. These are changes that grant new permissions — for example, adding an IAM statement that lets a Lambda read from S3, or creating a new IAM role.

```
This deployment will make potentially sensitive changes according to your current security approval level (--require-approval broadening).
Please confirm you intend to make the following modifications:
[IAM statement changes listed here]
Do you wish to deploy these changes (y/n)?
```

`--require-approval never` skips this prompt and applies all changes automatically. This is required for non-interactive environments like CI/CD pipelines where there's no human to type `y`.

**When to use it:**
- CI/CD pipelines: always use it (no human present)
- Local dev/staging deploys: fine to use, saves time
- Local production deploys: consider omitting it so you see the approval prompt and review IAM changes manually

---

### `--hotswap`

Bypasses CloudFormation for eligible changes and applies them directly to AWS. Only works for certain resource types — Lambda code, Lambda environment variables, Step Functions definitions, ECS task definitions.

For a Lambda code change, instead of:
1. Submit template to CloudFormation (~5s)
2. CloudFormation creates a changeset (~20s)
3. CloudFormation executes changeset (~60s)

Hotswap does:
1. Detect which Lambdas changed (~2s)
2. Upload new zip directly to Lambda (~3s)

Total: ~5s vs ~90s.

If you have a mix of hotswap-eligible and non-eligible changes in the same deploy (e.g. new Lambda code + new IAM role), CDK applies the eligible changes via hotswap and falls back to CloudFormation for the rest.

**Never use on production** — it can cause CloudFormation state to drift from what's actually deployed.

---

### `STAGE=prod` (environment variable prefix)

Sets the `STAGE` environment variable for that command. It's read by `infra/bin/app.ts`:

```typescript
const stage = process.env.STAGE ?? "prod";
new LnkshrtrStack(app, `LnkshrtrCdk-${stage}`, { stage, ... });
```

This determines:
- The CloudFormation stack name (`LnkshrtrCdk-prod`)
- Lambda function names (`lnkshrtr-prod-*`)
- SQS queue name (`lnkshrtr-prod-click-events`)
- CloudWatch log group names (`/aws/lambda/lnkshrtr-prod-*`)

If you omit it, it defaults to `prod` (see `?? "prod"` in app.ts).

---

### `cdk diff STACK_NAME`

Shows what would change if you ran `cdk deploy` right now. Does not make any changes to AWS. Reads the current deployed state from CloudFormation and compares it against your local code.

```bash
STAGE=prod npx cdk diff LnkshrtrCdk-prod
```

```
Stack LnkshrtrCdk-prod
Resources
[~] = update  [+] = add  [-] = remove

[~] AWS::Lambda::Function lnkshrtr-prod-auth-signup
 └─ [~] Code.S3Key  (Lambda zip changed)

[+] AWS::Lambda::Function lnkshrtr-prod-links-new-route  (new Lambda)
[+] AWS::ApiGatewayV2::Route GET /api/links/new          (new route)
```

Run this before every production deploy.

---

### `cdk bootstrap`

Creates the CDK support resources in your AWS account. You run this once per account/region and never again (unless you delete the bootstrap resources manually).

What it creates:
- **S3 bucket** — `cdk-hnb659fds-assets-{account}-{region}`: stores Lambda zip files before CloudFormation deploys them
- **IAM roles** — CloudFormation assumes these roles to create/update/delete resources on your behalf
- **ECR repository** — for Docker-based Lambdas (not used here, but created anyway)
- **SSM parameter** — records the bootstrap version so CDK knows if it needs to re-bootstrap

```bash
npx cdk bootstrap aws://389890955896/ap-southeast-1
```

---

### `cdk destroy STACK_NAME`

Deletes all resources in the named stack. Irreversible for most resources (Lambda functions, SQS queues, API Gateway). CloudWatch log groups are intentionally NOT deleted.

```bash
STAGE=dev npx cdk destroy LnkshrtrCdk-dev
```

CDK will ask for confirmation: `Are you sure you want to delete: LnkshrtrCdk-dev (y/n)?`

---

### `cdk synth`

Compiles your TypeScript CDK code into a CloudFormation template and prints it. Does not deploy anything. Useful for:
- Seeing exactly what CloudFormation template CDK generates
- Catching construct errors before a deploy
- Debugging unexpected resource configurations

```bash
STAGE=prod npx cdk synth LnkshrtrCdk-prod
```

---

## CI/CD with GitHub Actions

### What CI/CD means here

**CI (Continuous Integration):** Every pull request automatically runs the test suite. You see pass/fail before merging.

**CD (Continuous Deployment):** Every merge to `main` automatically deploys to production. Every merge to `develop` deploys to staging. No manual deploy step needed.

### How it works end to end

```
Developer pushes code to a branch
        ↓
Pull request opened
        ↓
GitHub Actions runs tests (ci.yml)
  - npm install
  - npm test (runs integration tests against Neon test DB)
  - if tests fail → PR is blocked
        ↓
PR is merged to develop or main
        ↓
GitHub Actions runs deploy (deploy.yml)
  - configures AWS credentials from secrets
  - runs cdk deploy with the right STAGE
  - runs smoke tests against the live URL
  - if smoke tests fail → team is notified (deploy succeeded but something is wrong)
```

### Workflow files

Create these two files in your repo:

**`.github/workflows/ci.yml`** — runs on every pull request:

```yaml
name: CI

on:
  pull_request:
    paths: ["server/cdk/**"]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install dependencies
        working-directory: server/cdk
        run: npm ci
        # npm ci is like npm install but:
        # - reads package-lock.json exactly (reproducible installs)
        # - fails if lock file is out of sync
        # - faster in CI because it skips some npm overhead

      - name: Type check
        working-directory: server/cdk
        run: npx tsc --noEmit
        # Catches TypeScript errors without emitting any files.
        # Faster than building — just validates types.

      - name: Run tests
        working-directory: server/cdk
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL_TEST }}
          # DATABASE_URL_TEST should point to a Neon test branch,
          # not your main dev or prod database.
        run: npm test
```

**`.github/workflows/deploy.yml`** — runs on merge to develop or main:

```yaml
name: Deploy

on:
  push:
    branches: [main, develop]
    paths: ["server/cdk/**"]
    # Only runs when files inside server/cdk/ changed.
    # A frontend-only change won't trigger this workflow.

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install dependencies
        working-directory: server/cdk
        run: npm ci

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-southeast-1
        # This action sets up the AWS CLI with the credentials from GitHub Secrets.
        # After this step, commands like `aws` and `cdk` are authenticated.

      - name: Set stage
        # main branch → prod, develop branch → staging
        run: |
          if [ "${{ github.ref_name }}" = "main" ]; then
            echo "STAGE=prod" >> $GITHUB_ENV
          else
            echo "STAGE=staging" >> $GITHUB_ENV
          fi
        # GITHUB_ENV is a special file. Writing to it sets environment variables
        # for all subsequent steps in the job.

      - name: Deploy
        working-directory: server/cdk
        env:
          STAGE: ${{ env.STAGE }}
          CDK_DEFAULT_ACCOUNT: ${{ secrets.AWS_ACCOUNT_ID }}
          CDK_DEFAULT_REGION: ap-southeast-1
          DATABASE_URL: ${{ env.STAGE == 'prod' && secrets.DATABASE_URL_PROD || secrets.DATABASE_URL_STAGING }}
          JWT_SECRET: ${{ env.STAGE == 'prod' && secrets.JWT_SECRET_PROD || secrets.JWT_SECRET_STAGING }}
          FRONTEND_URL: ${{ env.STAGE == 'prod' && vars.FRONTEND_URL_PROD || vars.FRONTEND_URL_STAGING }}
        run: npx cdk deploy LnkshrtrCdk-${{ env.STAGE }} --require-approval never
        # --require-approval never: skip the interactive IAM approval prompt.
        # Required in CI because there's no human to type 'y'.

      - name: Smoke test
        working-directory: server/cdk
        env:
          API_URL: ${{ env.STAGE == 'prod' && vars.API_URL_PROD || vars.API_URL_STAGING }}
        run: npx tsx scripts/test-endpoint.ts all --url ${{ env.API_URL }}
        # Runs the smoke test suite against the live deployed URL.
        # Tests: auth signup/login, create/read/update/delete links,
        # public profile endpoints, health checks.
```

### GitHub Secrets vs Variables

GitHub has two places to store configuration:

**Secrets** (Settings → Secrets and variables → Actions → Secrets): encrypted, never shown in logs, used for sensitive values.

| Secret name | What it is |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user access key (see "Creating a deploy IAM user" below) |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key |
| `AWS_ACCOUNT_ID` | Your 12-digit AWS account number (e.g. `389890955896`) |
| `DATABASE_URL_PROD` | Neon production database connection string |
| `DATABASE_URL_STAGING` | Neon staging database connection string |
| `DATABASE_URL_TEST` | Neon test branch connection string (for CI tests) |
| `JWT_SECRET_PROD` | JWT signing secret for prod (64+ random chars) |
| `JWT_SECRET_STAGING` | JWT signing secret for staging |

**Variables** (Settings → Secrets and variables → Actions → Variables): not encrypted, shown in logs, used for non-sensitive config.

| Variable name | Example value |
|---|---|
| `FRONTEND_URL_PROD` | `https://yourapp.com` |
| `FRONTEND_URL_STAGING` | `https://staging.yourapp.com` |
| `API_URL_PROD` | `https://24z8wa1hga.execute-api.ap-southeast-1.amazonaws.com` |
| `API_URL_STAGING` | `https://XXXX.execute-api.ap-southeast-1.amazonaws.com` |

### Creating a deploy IAM user for CI

Don't use your personal AWS credentials in GitHub. Create a dedicated IAM user with only the permissions needed to deploy:

```bash
# Create the user
aws iam create-user --user-name lnkshrtr-deploy

# Attach the AdministratorAccess policy (simplest, fine for solo/small team projects)
aws iam attach-user-policy \
  --user-name lnkshrtr-deploy \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

# Create access keys — save these, you can't view the secret again
aws iam create-access-key --user-name lnkshrtr-deploy
```

The output gives you `AccessKeyId` and `SecretAccessKey`. Paste these into GitHub Secrets as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

For tighter security on a larger team, replace `AdministratorAccess` with a custom policy that only allows Lambda, API Gateway, CloudFormation, SQS, IAM (scoped to the lnkshrtr prefix), and S3 (for CDK assets). This is more work but limits blast radius if the credentials are ever leaked.

### What the CI/CD flow looks like day-to-day

```
You make a change to src/modules/auth/handlers/login.handler.ts
        ↓
Push to a feature branch, open a PR
        ↓
ci.yml runs:
  - tsc --noEmit (type check passes)
  - npm test (auth tests pass)
  - PR shows green ✅
        ↓
You merge the PR to develop
        ↓
deploy.yml runs:
  - Sets STAGE=staging
  - cdk deploy LnkshrtrCdk-staging --require-approval never
    → CDK bundles lnkshrtr-staging-auth-login with esbuild
    → Uploads new zip to S3
    → CloudFormation updates the Lambda (~90 seconds)
  - smoke test runs against staging URL
  - All pass ✅
        ↓
You merge develop to main
        ↓
deploy.yml runs again:
  - Sets STAGE=prod
  - cdk deploy LnkshrtrCdk-prod --require-approval never
  - smoke test runs against prod URL
  - Done ✅
```

---

## Managing secrets per stage

### The `.env` file approach (local)

For local deploys, keep a `.env.prod` and `.env.staging` file (gitignored):

```bash
# .env.prod
DATABASE_URL=postgresql://user:pass@ep-cool-darkness.ap-southeast-1.aws.neon.tech/lnkshrtr?sslmode=require
JWT_SECRET=abc123...64chars
FRONTEND_URL=https://yourapp.com
STAGE=prod
CDK_DEFAULT_ACCOUNT=389890955896
CDK_DEFAULT_REGION=ap-southeast-1
UPSTASH_REDIS_URL=https://...upstash.io
UPSTASH_REDIS_TOKEN=...
```

Load and deploy:

```bash
set -a && source .env.prod && set +a
npx cdk deploy LnkshrtrCdk-prod --require-approval never
```

`set -a` exports all variables from the file into the shell environment. `set +a` turns that off after sourcing.

### Neon branches (recommended for dev/staging databases)

Neon supports branching — create a branch from main for each stage. Each branch has its own connection string but shares the schema from the parent:

```bash
# Using the Neon MCP or Neon console:
# Create branch "staging" from main
# Create branch "test" from main (for CI tests)
```

This way:
- prod → Neon main branch
- staging → Neon staging branch
- CI tests → Neon test branch (gets reset between runs if needed)

Changes to staging data don't affect prod. If a migration breaks staging, you can reset the staging branch from main.

---

## Troubleshooting

### "Stack is in ROLLBACK_COMPLETE state"

CloudFormation rolled back a previous failed deploy and the stack is stuck. Fix:

```bash
# Delete the stuck stack (this destroys all its resources)
STAGE=dev npx cdk destroy LnkshrtrCdk-dev

# Then redeploy from scratch
STAGE=dev npx cdk deploy LnkshrtrCdk-dev --require-approval never
```

Only do this on dev/staging. For prod, investigate why the deploy failed before deleting.

### "CDK bootstrap stack version X is newer than toolkit version Y"

Your local CDK version is older than what was used to bootstrap. Update CDK:

```bash
npm install -g aws-cdk@latest
npx cdk --version
```

Or re-bootstrap (safe to run again, it upgrades the bootstrap resources):

```bash
npx cdk bootstrap aws://ACCOUNT/REGION
```

### "Resource already exists" during deploy

A resource with the same name was created outside of CloudFormation (manually in the console, or from a previous deploy that's no longer tracked). Options:

1. **Import it** into the stack: `cdk import` (advanced)
2. **Delete the conflicting resource** in the AWS console, then redeploy
3. **Rename the resource** in your CDK code (change the `functionName` to something unique)

### Deploy succeeds but Lambda returns 500

Check CloudWatch logs immediately after:

```bash
aws logs tail /aws/lambda/lnkshrtr-prod-auth-signup --follow
```

Common causes:
- Missing environment variable (check `env.ts` for the module — Zod validation throws on missing required vars at cold start)
- Drizzle column name mismatch (query returns no rows when you expect one)
- JWT_SECRET not passed to the construct in `lnkshrtr-stack.ts`

### "The security token included in the request is expired"

Your AWS credentials have expired. Re-authenticate:

```bash
aws configure
# or if using SSO:
aws sso login --profile your-profile
```

### Smoke tests fail after a successful deploy

The deploy is fine but something is wrong at the application level. Check:

```bash
# Tail the specific Lambda that's failing
aws logs tail /aws/lambda/lnkshrtr-prod-auth-signup --follow --since 5m
```

Run the smoke test against staging first to confirm it's reproducible:

```bash
npx tsx scripts/test-endpoint.ts auth --url https://STAGING_URL
```
