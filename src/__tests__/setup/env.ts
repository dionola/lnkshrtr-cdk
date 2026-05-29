// Runs before any module is imported — set env vars for the test environment
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://stephen@localhost:5432/lnkshrtr_cdk_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.JWT_EXPIRES_IN = "7d";
process.env.BCRYPT_ROUNDS = "1";
process.env.FRONTEND_URL = "http://localhost:5173";
process.env.CLICK_QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/000000000000/test-queue";
process.env.GOOGLE_CLIENT_ID = "";
process.env.GOOGLE_CLIENT_SECRET = "";
process.env.GOOGLE_CALLBACK_URL = "http://localhost:3000/api/auth/google/callback";
// Disable cache in tests — no Upstash connection
delete process.env.UPSTASH_REDIS_URL;
delete process.env.UPSTASH_REDIS_TOKEN;
