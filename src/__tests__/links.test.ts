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

jest.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  SendMessageCommand: jest.fn(),
}));

import { handler as getLinksHandler } from "../modules/links/handlers/get-links.handler";
import { handler as createLinkHandler } from "../modules/links/handlers/create-link.handler";
import { handler as updateLinkHandler } from "../modules/links/handlers/update-link.handler";
import { handler as deleteLinkHandler } from "../modules/links/handlers/delete-link.handler";
import { handler as getLinkByCodeHandler } from "../modules/links/handlers/get-link-by-code.handler";
import { handler as verifyPasswordHandler } from "../modules/links/handlers/verify-link-password.handler";
import { handler as recordClickHandler } from "../modules/links/handlers/record-click.handler";
import { buildEvent, withBearer } from "./helpers/events";
import { createUserWithToken, createLink } from "./helpers/factories";
import { db } from "../../shared/db";
import { links } from "../../shared/db/schema";
import { eq } from "drizzle-orm";

function ok(res: unknown) {
  return (res as { statusCode: number }).statusCode;
}
function body(res: unknown) {
  return JSON.parse((res as { body: string }).body);
}

// ─── GET /api/links ───────────────────────────────────────────────────────────

describe("GET /api/links", () => {
  it("returns an empty array when user has no links", async () => {
    const { user } = await createUserWithToken();

    const res = await getLinksHandler(buildEvent({
      authContext: { userId: user.id },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res)).toEqual([]);
  });

  it("returns all links belonging to the authenticated user", async () => {
    const { user } = await createUserWithToken();
    await createLink({ userId: user.id, shortCode: "aaa111" });
    await createLink({ userId: user.id, shortCode: "bbb222" });

    const res = await getLinksHandler(buildEvent({
      authContext: { userId: user.id },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res)).toHaveLength(2);
    expect(body(res).every((l: { userId: string }) => l.userId === user.id)).toBe(true);
  });

  it("does not return links belonging to another user", async () => {
    const { user: user1 } = await createUserWithToken();
    const { user: user2 } = await createUserWithToken();
    await createLink({ userId: user1.id, shortCode: "u1link1" });
    await createLink({ userId: user2.id, shortCode: "u2link1" });

    const res = await getLinksHandler(buildEvent({
      authContext: { userId: user1.id },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res)).toHaveLength(1);
    expect(body(res)[0].userId).toBe(user1.id);
  });

  it("never returns the password field on any link", async () => {
    const { user } = await createUserWithToken();
    await createLink({ userId: user.id, shortCode: "pwlink1", isPasswordProtected: true, password: "secret99" });

    const res = await getLinksHandler(buildEvent({
      authContext: { userId: user.id },
    }));

    expect(ok(res)).toBe(200);
    body(res).forEach((link: Record<string, unknown>) => {
      expect(link.password).toBeUndefined();
    });
  });

  it("returns links ordered newest first", async () => {
    const { user } = await createUserWithToken();
    const first = await createLink({ userId: user.id, shortCode: "old001" });
    await new Promise((r) => setTimeout(r, 10));
    const second = await createLink({ userId: user.id, shortCode: "new001" });

    const res = await getLinksHandler(buildEvent({
      authContext: { userId: user.id },
    }));

    expect(body(res)[0].id).toBe(second.id);
    expect(body(res)[1].id).toBe(first.id);
  });
});

// ─── POST /api/links ──────────────────────────────────────────────────────────

describe("POST /api/links", () => {
  it("creates a link and returns 201", async () => {
    const { user, token } = await createUserWithToken();

    const res = await createLinkHandler(buildEvent({
      headers: withBearer(token),
      body: { url: "https://example.com" },
    }));

    expect(ok(res)).toBe(201);
    expect(body(res).originalUrl).toBe("https://example.com");
    expect(body(res).shortCode).toBeDefined();
    expect(body(res).userId).toBe(user.id);
  });

  it("defaults isPublic=true, isPasswordProtected=false, type=link, visits=0", async () => {
    const { token } = await createUserWithToken();

    const res = await createLinkHandler(buildEvent({
      headers: withBearer(token),
      body: { url: "https://example.com" },
    }));

    expect(body(res).isPublic).toBe(true);
    expect(body(res).isPasswordProtected).toBe(false);
    expect(body(res).type).toBe("link");
    expect(body(res).visits).toBe(0);
    expect(body(res).isActive).toBe(true);
  });

  it("sets title to the hostname of the URL", async () => {
    const { token } = await createUserWithToken();

    const res = await createLinkHandler(buildEvent({
      headers: withBearer(token),
      body: { url: "https://github.com/user/repo" },
    }));

    expect(body(res).title).toBe("github.com");
  });

  it("uses a custom short code when provided", async () => {
    const { token } = await createUserWithToken();

    const res = await createLinkHandler(buildEvent({
      headers: withBearer(token),
      body: { url: "https://example.com", customCode: "mycode" },
    }));

    expect(ok(res)).toBe(201);
    expect(body(res).shortCode).toBe("mycode");
  });

  it("returns 409 when custom code is already taken", async () => {
    const { user, token } = await createUserWithToken();
    await createLink({ userId: user.id, shortCode: "taken1" });

    const res = await createLinkHandler(buildEvent({
      headers: withBearer(token),
      body: { url: "https://example.com", customCode: "taken1" },
    }));

    expect(ok(res)).toBe(409);
    expect(body(res).error.code).toBe("CONFLICT");
  });

  it("creates a private link when isPublic=false", async () => {
    const { token } = await createUserWithToken();

    const res = await createLinkHandler(buildEvent({
      headers: withBearer(token),
      body: { url: "https://example.com", isPublic: false },
    }));

    expect(ok(res)).toBe(201);
    expect(body(res).isPublic).toBe(false);
  });

  it("creates a password-protected link", async () => {
    const { token } = await createUserWithToken();

    const res = await createLinkHandler(buildEvent({
      headers: withBearer(token),
      body: { url: "https://example.com", isPasswordProtected: true, password: "secret99" },
    }));

    expect(ok(res)).toBe(201);
    expect(body(res).isPasswordProtected).toBe(true);
    expect(body(res).password).toBeUndefined();
  });

  it("returns 400 for a non-URL string", async () => {
    const { token } = await createUserWithToken();

    const res = await createLinkHandler(buildEvent({
      headers: withBearer(token),
      body: { url: "not-a-url-at-all" },
    }));

    expect(ok(res)).toBe(400);
    expect(body(res).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when url is missing", async () => {
    const { token } = await createUserWithToken();

    const res = await createLinkHandler(buildEvent({
      headers: withBearer(token),
      body: { isPublic: true },
    }));

    expect(ok(res)).toBe(400);
    expect(body(res).error.code).toBe("VALIDATION_ERROR");
  });

  it("allows unauthenticated creation — userId is null", async () => {
    const res = await createLinkHandler(buildEvent({
      body: { url: "https://example.com" },
    }));

    expect(ok(res)).toBe(201);
    expect(body(res).userId).toBeNull();
  });

  it("http:// URLs are accepted", async () => {
    const { token } = await createUserWithToken();

    const res = await createLinkHandler(buildEvent({
      headers: withBearer(token),
      body: { url: "http://example.com" },
    }));

    expect(ok(res)).toBe(201);
    expect(body(res).originalUrl).toBe("http://example.com");
  });
});

// ─── PUT /api/links/{id} ──────────────────────────────────────────────────────

describe("PUT /api/links/{id}", () => {
  it("updates link title", async () => {
    const { user } = await createUserWithToken();
    const link = await createLink({ userId: user.id, shortCode: "upd001" });

    const res = await updateLinkHandler(buildEvent({
      pathParameters: { id: link.id },
      authContext: { userId: user.id },
      body: { title: "New Title" },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res).title).toBe("New Title");
  });

  it("updates isPublic to false", async () => {
    const { user } = await createUserWithToken();
    const link = await createLink({ userId: user.id, shortCode: "upd002", isPublic: true });

    const res = await updateLinkHandler(buildEvent({
      pathParameters: { id: link.id },
      authContext: { userId: user.id },
      body: { isPublic: false },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res).isPublic).toBe(false);
  });

  it("deactivates a link with isActive=false", async () => {
    const { user } = await createUserWithToken();
    const link = await createLink({ userId: user.id, shortCode: "upd003" });

    const res = await updateLinkHandler(buildEvent({
      pathParameters: { id: link.id },
      authContext: { userId: user.id },
      body: { isActive: false },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res).isActive).toBe(false);
  });

  it("enables password protection with a valid password", async () => {
    const { user } = await createUserWithToken();
    const link = await createLink({ userId: user.id, shortCode: "upd004" });

    const res = await updateLinkHandler(buildEvent({
      pathParameters: { id: link.id },
      authContext: { userId: user.id },
      body: { isPasswordProtected: true, password: "newpassword" },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res).isPasswordProtected).toBe(true);
    expect(body(res).password).toBeUndefined();
  });

  it("disabling password protection clears the stored password in DB", async () => {
    const { user } = await createUserWithToken();
    const link = await createLink({
      userId: user.id,
      shortCode: "upd005",
      isPasswordProtected: true,
      password: "oldpass1",
    });

    await updateLinkHandler(buildEvent({
      pathParameters: { id: link.id },
      authContext: { userId: user.id },
      body: { isPasswordProtected: false },
    }));

    const [dbLink] = await db.select().from(links).where(eq(links.id, link.id)).limit(1);
    expect(dbLink.password).toBeNull();
    expect(dbLink.isPasswordProtected).toBe(false);
  });

  it("returns 404 for a non-existent link id", async () => {
    const { user } = await createUserWithToken();

    const res = await updateLinkHandler(buildEvent({
      pathParameters: { id: "nonexistent-id" },
      authContext: { userId: user.id },
      body: { title: "Ghost" },
    }));

    expect(ok(res)).toBe(404);
    expect(body(res).error.code).toBe("NOT_FOUND");
  });

  it("returns 403 when trying to update another user's link", async () => {
    const { user: owner } = await createUserWithToken();
    const { user: attacker } = await createUserWithToken();
    const link = await createLink({ userId: owner.id, shortCode: "upd006" });

    const res = await updateLinkHandler(buildEvent({
      pathParameters: { id: link.id },
      authContext: { userId: attacker.id },
      body: { title: "Hijacked" },
    }));

    expect(ok(res)).toBe(403);
    expect(body(res).error.code).toBe("FORBIDDEN");
  });

  it("partial update — untouched fields remain unchanged", async () => {
    const { user } = await createUserWithToken();
    const link = await createLink({ userId: user.id, shortCode: "upd007", isPublic: false });

    const res = await updateLinkHandler(buildEvent({
      pathParameters: { id: link.id },
      authContext: { userId: user.id },
      body: { title: "Only Title Changed" },
    }));

    expect(body(res).title).toBe("Only Title Changed");
    expect(body(res).isPublic).toBe(false);
  });

  it("persists changes to the database", async () => {
    const { user } = await createUserWithToken();
    const link = await createLink({ userId: user.id, shortCode: "upd008" });

    await updateLinkHandler(buildEvent({
      pathParameters: { id: link.id },
      authContext: { userId: user.id },
      body: { title: "Persisted Title" },
    }));

    const [dbLink] = await db.select().from(links).where(eq(links.id, link.id)).limit(1);
    expect(dbLink.title).toBe("Persisted Title");
  });
});

// ─── DELETE /api/links/{id} ───────────────────────────────────────────────────

describe("DELETE /api/links/{id}", () => {
  it("deletes own link and returns 204", async () => {
    const { user } = await createUserWithToken();
    const link = await createLink({ userId: user.id, shortCode: "del001" });

    const res = await deleteLinkHandler(buildEvent({
      pathParameters: { id: link.id },
      authContext: { userId: user.id },
    }));

    expect(ok(res)).toBe(204);
    const dbLinks = await db.select().from(links).where(eq(links.id, link.id));
    expect(dbLinks).toHaveLength(0);
  });

  it("returns 404 for a non-existent link id", async () => {
    const { user } = await createUserWithToken();

    const res = await deleteLinkHandler(buildEvent({
      pathParameters: { id: "nonexistent-id" },
      authContext: { userId: user.id },
    }));

    expect(ok(res)).toBe(404);
    expect(body(res).error.code).toBe("NOT_FOUND");
  });

  it("returns 403 when trying to delete another user's link", async () => {
    const { user: owner } = await createUserWithToken();
    const { user: attacker } = await createUserWithToken();
    const link = await createLink({ userId: owner.id, shortCode: "del002" });

    const res = await deleteLinkHandler(buildEvent({
      pathParameters: { id: link.id },
      authContext: { userId: attacker.id },
    }));

    expect(ok(res)).toBe(403);
    expect(body(res).error.code).toBe("FORBIDDEN");

    const dbLinks = await db.select().from(links).where(eq(links.id, link.id));
    expect(dbLinks).toHaveLength(1);
  });

  it("other users' links are not affected", async () => {
    const { user } = await createUserWithToken();
    const { user: other } = await createUserWithToken();
    const ownLink = await createLink({ userId: user.id, shortCode: "del003" });
    const otherLink = await createLink({ userId: other.id, shortCode: "del004" });

    await deleteLinkHandler(buildEvent({
      pathParameters: { id: ownLink.id },
      authContext: { userId: user.id },
    }));

    const remaining = await db.select().from(links).where(eq(links.id, otherLink.id));
    expect(remaining).toHaveLength(1);
  });
});

// ─── GET /api/links/code/{shortCode} ─────────────────────────────────────────

describe("GET /api/links/code/{shortCode}", () => {
  it("returns link by short code without auth", async () => {
    await createLink({ shortCode: "pub001", originalUrl: "https://example.com" });

    const res = await getLinkByCodeHandler(buildEvent({
      pathParameters: { shortCode: "pub001" },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res).shortCode).toBe("pub001");
    expect(body(res).originalUrl).toBe("https://example.com");
  });

  it("never returns the password field", async () => {
    await createLink({ shortCode: "pub002", isPasswordProtected: true, password: "secret99" });

    const res = await getLinkByCodeHandler(buildEvent({
      pathParameters: { shortCode: "pub002" },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res).password).toBeUndefined();
  });

  it("returns the isPasswordProtected flag", async () => {
    await createLink({ shortCode: "pub003", isPasswordProtected: true, password: "secret99" });

    const res = await getLinkByCodeHandler(buildEvent({
      pathParameters: { shortCode: "pub003" },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res).isPasswordProtected).toBe(true);
  });

  it("returns private links — frontend handles gating", async () => {
    await createLink({ shortCode: "pub004", isPublic: false });

    const res = await getLinkByCodeHandler(buildEvent({
      pathParameters: { shortCode: "pub004" },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res).isPublic).toBe(false);
  });

  it("returns 404 for an unknown short code", async () => {
    const res = await getLinkByCodeHandler(buildEvent({
      pathParameters: { shortCode: "unknown" },
    }));

    expect(ok(res)).toBe(404);
    expect(body(res).error.code).toBe("NOT_FOUND");
  });
});

// ─── POST /api/links/code/{shortCode}/click ───────────────────────────────────

describe("POST /api/links/code/{shortCode}/click", () => {
  it("returns 200 (SQS send is mocked at module level)", async () => {
    const res = await recordClickHandler(buildEvent({
      pathParameters: { shortCode: "clk001" },
    }));

    expect(ok(res)).toBe(200);
  });

  it("does not require authentication", async () => {
    const res = await recordClickHandler(buildEvent({
      pathParameters: { shortCode: "clk002" },
    }));

    expect(ok(res)).toBe(200);
  });
});

// ─── POST /api/links/code/{shortCode} (verify password) ──────────────────────

describe("POST /api/links/code/{shortCode} (verify password)", () => {
  it("returns true for the correct password", async () => {
    await createLink({ shortCode: "pw001", isPasswordProtected: true, password: "correctpass" });

    const res = await verifyPasswordHandler(buildEvent({
      pathParameters: { shortCode: "pw001" },
      body: { password: "correctpass" },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res)).toBe(true);
  });

  it("returns false for the wrong password", async () => {
    await createLink({ shortCode: "pw002", isPasswordProtected: true, password: "correctpass" });

    const res = await verifyPasswordHandler(buildEvent({
      pathParameters: { shortCode: "pw002" },
      body: { password: "wrongpass" },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res)).toBe(false);
  });

  it("returns true for an unprotected link", async () => {
    await createLink({ shortCode: "pw003", isPasswordProtected: false });

    const res = await verifyPasswordHandler(buildEvent({
      pathParameters: { shortCode: "pw003" },
      body: { password: "anything" },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res)).toBe(true);
  });

  it("returns 404 for a non-existent short code", async () => {
    const res = await verifyPasswordHandler(buildEvent({
      pathParameters: { shortCode: "noexist" },
      body: { password: "anything" },
    }));

    expect(ok(res)).toBe(404);
    expect(body(res).error.code).toBe("NOT_FOUND");
  });

  it("returns 400 when password field is missing", async () => {
    await createLink({ shortCode: "pw004", isPasswordProtected: true });

    const res = await verifyPasswordHandler(buildEvent({
      pathParameters: { shortCode: "pw004" },
      body: {},
    }));

    expect(ok(res)).toBe(400);
    expect(body(res).error.code).toBe("VALIDATION_ERROR");
  });

  it("does not require auth to verify password", async () => {
    await createLink({ shortCode: "pw005", isPasswordProtected: true, password: "correctpass" });

    const res = await verifyPasswordHandler(buildEvent({
      pathParameters: { shortCode: "pw005" },
      body: { password: "correctpass" },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res)).toBe(true);
  });
});
