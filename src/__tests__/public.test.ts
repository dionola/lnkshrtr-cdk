jest.mock("../../shared/utils/cache", () => ({
  cache: {
    getLinkByCode: jest.fn().mockResolvedValue(null),
    setLinkByCode: jest.fn().mockResolvedValue(undefined),
    getUserLinks: jest.fn().mockResolvedValue(null),
    setUserLinks: jest.fn().mockResolvedValue(undefined),
    getPublicUser: jest.fn().mockResolvedValue(null),
    setPublicUser: jest.fn().mockResolvedValue(undefined),
    getPublicLinks: jest.fn().mockResolvedValue(null),
    setPublicLinks: jest.fn().mockResolvedValue(undefined),
    invalidateAll: jest.fn().mockResolvedValue(undefined),
  },
}));

import { handler as getPublicProfileHandler } from "../modules/public/handlers/get-public-profile.handler";
import { handler as getPublicLinksHandler } from "../modules/public/handlers/get-public-links.handler";
import { buildEvent } from "./helpers/events";
import { createUser, createLink } from "./helpers/factories";

function ok(res: unknown) {
  return (res as { statusCode: number }).statusCode;
}
function body(res: unknown) {
  return JSON.parse((res as { body: string }).body);
}

// ─── GET /api/public/{username} ───────────────────────────────────────────────

describe("GET /api/public/{username}", () => {
  it("returns a public user profile", async () => {
    await createUser({ username: "publicuser", email: "pub@example.com" });

    const res = await getPublicProfileHandler(buildEvent({
      pathParameters: { username: "publicuser" },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res).username).toBe("publicuser");
    expect(body(res).email).toBe("pub@example.com");
    expect(body(res).id).toBeDefined();
    expect(body(res).createdAt).toBeDefined();
  });

  it("includes all expected fields in the response", async () => {
    await createUser({ username: "fieldtest", email: "fieldtest@example.com" });

    const res = await getPublicProfileHandler(buildEvent({
      pathParameters: { username: "fieldtest" },
    }));

    expect(body(res).id).toBeDefined();
    expect(body(res).username).toBeDefined();
    expect(body(res).email).toBeDefined();
    expect(body(res).createdAt).toBeDefined();
  });

  it("never returns a password field", async () => {
    await createUser({ username: "pwuser", email: "pwuser@example.com", password: "secret" });

    const res = await getPublicProfileHandler(buildEvent({
      pathParameters: { username: "pwuser" },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res).password).toBeUndefined();
  });

  it("returns 404 for an unknown username", async () => {
    const res = await getPublicProfileHandler(buildEvent({
      pathParameters: { username: "nosuchuser" },
    }));

    expect(ok(res)).toBe(404);
    expect(body(res).error.code).toBe("NOT_FOUND");
  });

  it("does not require authentication", async () => {
    await createUser({ username: "noauth", email: "noauth@example.com" });

    const res = await getPublicProfileHandler(buildEvent({
      pathParameters: { username: "noauth" },
    }));

    expect(ok(res)).toBe(200);
  });
});

// ─── GET /api/public/{username}/links ────────────────────────────────────────

describe("GET /api/public/{username}/links", () => {
  it("returns public active links for a user", async () => {
    const user = await createUser({ username: "linkowner", email: "lo@example.com" });
    await createLink({ userId: user.id, shortCode: "pubL01", isPublic: true, isActive: true });
    await createLink({ userId: user.id, shortCode: "pubL02", isPublic: true, isActive: true });

    const res = await getPublicLinksHandler(buildEvent({
      pathParameters: { username: "linkowner" },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res)).toHaveLength(2);
  });

  it("excludes private links", async () => {
    const user = await createUser({ username: "privowner", email: "priv@example.com" });
    await createLink({ userId: user.id, shortCode: "pubV01", isPublic: true, isActive: true });
    await createLink({ userId: user.id, shortCode: "pubV02", isPublic: false, isActive: true });

    const res = await getPublicLinksHandler(buildEvent({
      pathParameters: { username: "privowner" },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res)).toHaveLength(1);
    expect(body(res)[0].shortCode).toBe("pubV01");
  });

  it("excludes inactive links", async () => {
    const user = await createUser({ username: "inactowner", email: "inact@example.com" });
    await createLink({ userId: user.id, shortCode: "pubI01", isPublic: true, isActive: true });
    await createLink({ userId: user.id, shortCode: "pubI02", isPublic: true, isActive: false });

    const res = await getPublicLinksHandler(buildEvent({
      pathParameters: { username: "inactowner" },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res)).toHaveLength(1);
    expect(body(res)[0].shortCode).toBe("pubI01");
  });

  it("excludes both private and inactive links simultaneously", async () => {
    const user = await createUser({ username: "mixed", email: "mixed@example.com" });
    await createLink({ userId: user.id, shortCode: "mx001", isPublic: true,  isActive: true  });
    await createLink({ userId: user.id, shortCode: "mx002", isPublic: false, isActive: false });
    await createLink({ userId: user.id, shortCode: "mx003", isPublic: true,  isActive: false });
    await createLink({ userId: user.id, shortCode: "mx004", isPublic: false, isActive: true  });

    const res = await getPublicLinksHandler(buildEvent({
      pathParameters: { username: "mixed" },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res)).toHaveLength(1);
    expect(body(res)[0].shortCode).toBe("mx001");
  });

  it("returns an empty array when user has no public active links", async () => {
    const user = await createUser({ username: "emptylinks", email: "empty@example.com" });
    await createLink({ userId: user.id, shortCode: "el001", isPublic: false });

    const res = await getPublicLinksHandler(buildEvent({
      pathParameters: { username: "emptylinks" },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res)).toEqual([]);
  });

  it("never returns password fields in any link", async () => {
    const user = await createUser({ username: "pwlinks", email: "pwlinks@example.com" });
    await createLink({
      userId: user.id,
      shortCode: "pwL01",
      isPublic: true,
      isActive: true,
      isPasswordProtected: true,
      password: "hidden99",
    });

    const res = await getPublicLinksHandler(buildEvent({
      pathParameters: { username: "pwlinks" },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res)[0].password).toBeUndefined();
  });

  it("returns 404 when the user does not exist", async () => {
    const res = await getPublicLinksHandler(buildEvent({
      pathParameters: { username: "nosuchuser" },
    }));

    expect(ok(res)).toBe(404);
    expect(body(res).error.code).toBe("NOT_FOUND");
  });

  it("does not return links belonging to a different user", async () => {
    const user1 = await createUser({ username: "user1pub", email: "u1pub@example.com" });
    const user2 = await createUser({ username: "user2pub", email: "u2pub@example.com" });
    await createLink({ userId: user1.id, shortCode: "u1L01" });
    await createLink({ userId: user2.id, shortCode: "u2L01" });

    const res = await getPublicLinksHandler(buildEvent({
      pathParameters: { username: "user1pub" },
    }));

    expect(ok(res)).toBe(200);
    expect(body(res)).toHaveLength(1);
    expect(body(res)[0].userId).toBe(user1.id);
  });

  it("does not require authentication", async () => {
    const user = await createUser({ username: "noauthlinks", email: "nal@example.com" });
    await createLink({ userId: user.id, shortCode: "nal001" });

    const res = await getPublicLinksHandler(buildEvent({
      pathParameters: { username: "noauthlinks" },
    }));

    expect(ok(res)).toBe(200);
  });
});
