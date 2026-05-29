import { db } from "../../../shared/db";
import { links, users } from "../../../shared/db/schema";

beforeEach(async () => {
  await db.delete(links);
  await db.delete(users);
});

afterAll(async () => {
  await db.delete(links);
  await db.delete(users);
});
