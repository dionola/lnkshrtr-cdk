import { Client } from "pg";

export default async function globalSetup(): Promise<void> {
  const connectionString =
    process.env.TEST_DATABASE_URL ?? "postgresql://stephen@localhost:5432/lnkshrtr_cdk_test";

  // Verify the test database is reachable before running any suites.
  // Run `drizzle-kit push` manually once to initialise the schema:
  //   DATABASE_URL=<connectionString> npx drizzle-kit push
  const client = new Client({ connectionString });
  await client.connect();
  await client.query("SELECT 1");
  await client.end();
}
