import jwt from "jsonwebtoken";

jest.mock("../../shared/utils/cache", () => ({
  cache: {
    getLinkByCode: jest.fn().mockResolvedValue(null),
    setLinkByCode: jest.fn().mockResolvedValue(undefined),
    invalidateLinkByCode: jest.fn().mockResolvedValue(undefined),
    getUserLinks: jest.fn().mockResolvedValue(null),
    setUserLinks: jest.fn().mockResolvedValue(undefined),
    invalidateUserLinks: jest.fn().mockResolvedValue(undefined),
    getPublicUser: jest.fn().mockResolvedValue(null),
    setPublicUser: jest.fn().mockResolvedValue(undefined),
    getPublicLinks: jest.fn().mockResolvedValue(null),
    setPublicLinks: jest.fn().mockResolvedValue(undefined),
    invalidateAll: jest.fn().mockResolvedValue(undefined),
  },
}));

import { handler as signupHandler } from "../modules/auth/handlers/signup.handler";
import { handler as loginHandler } from "../modules/auth/handlers/login.handler";
import { handler as meHandler } from "../modules/auth/handlers/me.handler";
import { handler as googleHandler } from "../modules/auth/handlers/google.handler";
import { buildEvent } from "./helpers/events";
import { createUser, createUserWithToken } from "./helpers/factories";
import { db } from "../../shared/db";
import { users } from "../../shared/db/schema";
import { eq } from "drizzle-orm";

// ─── POST /api/auth/signup ────────────────────────────────────────────────────

describe("POST /api/auth/signup", () => {
  it("registers a new user and returns user + accessToken", async () => {
    const event = buildEvent({
      body: { username: "alice", email: "alice@example.com", password: "password123" },
    });

    const res = await signupHandler(event);
    const body = JSON.parse((res as { body: string }).body);

    expect((res as { statusCode: number }).statusCode).toBe(201);
    expect(body.user).toMatchObject({ username: "alice", email: "alice@example.com" });
    expect(body.accessToken).toBeDefined();
    expect(typeof body.accessToken).toBe("string");
  });

  it("never returns a password field in the response", async () => {
    const event = buildEvent({
      body: { username: "bob", email: "bob@example.com", password: "password123" },
    });

    const res = await signupHandler(event);
    const body = JSON.parse((res as { body: string }).body);

    expect(body.user.password).toBeUndefined();
  });

  it("user response includes all expected fields", async () => {
    const event = buildEvent({
      body: { username: "fielduser", email: "fielduser@example.com", password: "password123" },
    });

    const res = await signupHandler(event);
    const body = JSON.parse((res as { body: string }).body);
    const user = body.user;

    expect(user.id).toBeDefined();
    expect(user.username).toBe("fielduser");
    expect(user.email).toBe("fielduser@example.com");
    expect(user.createdAt).toBeDefined();
    expect(user.password).toBeUndefined();
  });

  it("password is hashed in the database", async () => {
    const event = buildEvent({
      body: { username: "hashcheck", email: "hashcheck@example.com", password: "password123" },
    });

    await signupHandler(event);

    const [dbUser] = await db.select().from(users).where(eq(users.email, "hashcheck@example.com")).limit(1);
    expect(dbUser.password).not.toBe("password123");
    expect(/^\$2[ab]\$/.test(dbUser.password!)).toBe(true);
  });

  it("returns a valid JWT payload with sub = user id", async () => {
    const event = buildEvent({
      body: { username: "carol", email: "carol@example.com", password: "password123" },
    });

    const res = await signupHandler(event);
    const body = JSON.parse((res as { body: string }).body);
    const decoded = jwt.decode(body.accessToken) as { sub: string };

    expect(decoded.sub).toBe(body.user.id);
  });

  it("access token is a valid JWT signed with the app secret", async () => {
    const event = buildEvent({
      body: { username: "jwtcheck", email: "jwtcheck@example.com", password: "password123" },
    });

    const res = await signupHandler(event);
    const body = JSON.parse((res as { body: string }).body);
    const decoded = jwt.verify(body.accessToken, process.env.JWT_SECRET!) as { sub: string };

    expect(decoded.sub).toBe(body.user.id);
  });

  it("returns 409 when email is already taken", async () => {
    await createUser({ email: "taken@example.com", username: "existing1" });

    const event = buildEvent({
      body: { username: "newuser", email: "taken@example.com", password: "password123" },
    });

    const res = await signupHandler(event);
    const body = JSON.parse((res as { body: string }).body);

    expect((res as { statusCode: number }).statusCode).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).toMatch(/email/i);
  });

  it("returns 409 when username is already taken", async () => {
    await createUser({ username: "takenname", email: "unique@example.com" });

    const event = buildEvent({
      body: { username: "takenname", email: "different@example.com", password: "password123" },
    });

    const res = await signupHandler(event);
    const body = JSON.parse((res as { body: string }).body);

    expect((res as { statusCode: number }).statusCode).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).toMatch(/username/i);
  });

  it("returns 400 when username is shorter than 3 characters", async () => {
    const event = buildEvent({
      body: { username: "ab", email: "short@example.com", password: "password123" },
    });

    const res = await signupHandler(event);
    const body = JSON.parse((res as { body: string }).body);

    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when password is shorter than 8 characters", async () => {
    const event = buildEvent({
      body: { username: "validname", email: "valid@example.com", password: "short" },
    });

    const res = await signupHandler(event);
    const body = JSON.parse((res as { body: string }).body);

    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when email is invalid", async () => {
    const event = buildEvent({
      body: { username: "validname", email: "not-an-email", password: "password123" },
    });

    const res = await signupHandler(event);
    const body = JSON.parse((res as { body: string }).body);

    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when body is empty", async () => {
    const event = buildEvent({ body: {} });
    const res = await signupHandler(event);
    const body = JSON.parse((res as { body: string }).body);

    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("username exactly 3 characters is accepted", async () => {
    const event = buildEvent({
      body: { username: "abc", email: "abc@example.com", password: "password123" },
    });

    const res = await signupHandler(event);
    expect((res as { statusCode: number }).statusCode).toBe(201);
  });

  it("password exactly 8 characters is accepted", async () => {
    const event = buildEvent({
      body: { username: "eightpw", email: "eightpw@example.com", password: "12345678" },
    });

    const res = await signupHandler(event);
    expect((res as { statusCode: number }).statusCode).toBe(201);
  });
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

describe("POST /api/auth/login", () => {
  it("returns user and accessToken with valid credentials", async () => {
    await createUser({ email: "login@example.com", password: "secret99!!" });

    const event = buildEvent({
      body: { email: "login@example.com", password: "secret99!!" },
    });

    const res = await loginHandler(event);
    const body = JSON.parse((res as { body: string }).body);

    expect((res as { statusCode: number }).statusCode).toBe(200);
    expect(body.user).toMatchObject({ email: "login@example.com" });
    expect(body.accessToken).toBeDefined();
  });

  it("never returns a password field", async () => {
    await createUser({ email: "nopw@example.com", password: "secret99!!" });

    const event = buildEvent({
      body: { email: "nopw@example.com", password: "secret99!!" },
    });

    const res = await loginHandler(event);
    const body = JSON.parse((res as { body: string }).body);

    expect(body.user.password).toBeUndefined();
  });

  it("returns 401 for wrong password", async () => {
    await createUser({ email: "wrong@example.com", password: "correctpass" });

    const event = buildEvent({
      body: { email: "wrong@example.com", password: "wrongpass" },
    });

    const res = await loginHandler(event);
    const body = JSON.parse((res as { body: string }).body);

    expect((res as { statusCode: number }).statusCode).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 for non-existent email", async () => {
    const event = buildEvent({
      body: { email: "nobody@example.com", password: "password123" },
    });

    const res = await loginHandler(event);
    const body = JSON.parse((res as { body: string }).body);

    expect((res as { statusCode: number }).statusCode).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 for OAuth user who has no password", async () => {
    await createUser({ email: "oauth@example.com", oauth: true });

    const event = buildEvent({
      body: { email: "oauth@example.com", password: "anypassword" },
    });

    const res = await loginHandler(event);
    const body = JSON.parse((res as { body: string }).body);

    expect((res as { statusCode: number }).statusCode).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 400 when email is missing", async () => {
    const event = buildEvent({
      body: { password: "password123" },
    });

    const res = await loginHandler(event);
    const body = JSON.parse((res as { body: string }).body);

    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when password is missing", async () => {
    const event = buildEvent({
      body: { email: "valid@example.com" },
    });

    const res = await loginHandler(event);
    const body = JSON.parse((res as { body: string }).body);

    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 with invalid email format", async () => {
    const event = buildEvent({
      body: { email: "not-an-email", password: "password123" },
    });

    const res = await loginHandler(event);
    const body = JSON.parse((res as { body: string }).body);

    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("wrong email and wrong password return the same error message", async () => {
    await createUser({ email: "real@example.com", password: "realpass123" });

    const badEmail = buildEvent({
      body: { email: "fake@example.com", password: "realpass123" },
    });
    const badPass = buildEvent({
      body: { email: "real@example.com", password: "wrongpass" },
    });

    const r1 = await loginHandler(badEmail);
    const r2 = await loginHandler(badPass);

    expect(JSON.parse((r1 as { body: string }).body).error.message)
      .toBe(JSON.parse((r2 as { body: string }).body).error.message);
  });

  it("access token contains the correct user id as sub", async () => {
    const user = await createUser({ email: "tokencheck@example.com", password: "secret99!!" });

    const event = buildEvent({
      body: { email: "tokencheck@example.com", password: "secret99!!" },
    });

    const res = await loginHandler(event);
    const body = JSON.parse((res as { body: string }).body);
    const decoded = jwt.verify(body.accessToken, process.env.JWT_SECRET!) as { sub: string };

    expect(decoded.sub).toBe(user.id);
  });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

describe("GET /api/auth/me", () => {
  it("returns the authenticated user from authorizer context", async () => {
    const { user } = await createUserWithToken({ username: "meuser", email: "me@example.com" });

    const event = buildEvent({
      authContext: { userId: user.id, username: user.username, email: user.email },
    });

    const res = await meHandler(event);
    const body = JSON.parse((res as { body: string }).body);

    expect((res as { statusCode: number }).statusCode).toBe(200);
    expect(body.id).toBe(user.id);
    expect(body.username).toBe("meuser");
    expect(body.email).toBe("me@example.com");
  });

  it("never returns a password field", async () => {
    const { user } = await createUserWithToken({ password: "secret" });

    const event = buildEvent({
      authContext: { userId: user.id },
    });

    const res = await meHandler(event);
    const body = JSON.parse((res as { body: string }).body);

    expect(body.password).toBeUndefined();
  });

  it("returns 401 when authorizer context has a userId that no longer exists", async () => {
    const event = buildEvent({
      authContext: { userId: "nonexistent-id" },
    });

    const res = await meHandler(event);
    expect((res as { statusCode: number }).statusCode).toBe(401);
  });
});

// ─── GET /api/auth/google ─────────────────────────────────────────────────────

describe("GET /api/auth/google", () => {
  it("returns 501 when Google OAuth is not configured", async () => {
    const event = buildEvent({});

    const res = await googleHandler(event);
    const body = JSON.parse((res as { body: string }).body);

    expect((res as { statusCode: number }).statusCode).toBe(501);
    expect(body.error.code).toBe("NOT_IMPLEMENTED");
  });
});
