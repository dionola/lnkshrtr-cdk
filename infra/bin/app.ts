import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import * as dotenv from "dotenv";
import * as path from "path";
import { LnkshrtrStack } from "../lib/stacks/lnkshrtr-stack";

dotenv.config({ path: path.join(__dirname, "../../.env") });

const app = new cdk.App();

const stage = process.env.STAGE ?? "prod";

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "ap-southeast-1",
};

const appEnv: Record<string, string> = {
  DATABASE_URL: process.env.DATABASE_URL!,
  UPSTASH_REDIS_URL: process.env.UPSTASH_REDIS_URL ?? "",
  UPSTASH_REDIS_TOKEN: process.env.UPSTASH_REDIS_TOKEN ?? "",
  JWT_SECRET: process.env.JWT_SECRET!,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "7d",
  BCRYPT_ROUNDS: process.env.BCRYPT_ROUNDS ?? "10",
  FRONTEND_URL: process.env.FRONTEND_URL!,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? "",
  GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL ?? "",
};

new LnkshrtrStack(app, `LnkshrtrCdk-${stage}`, { env, appEnv, stage });
