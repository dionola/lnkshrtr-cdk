import * as fs from "fs";
import * as path from "path";

const SESSION_FILE = path.join(__dirname, "../.test-session");

interface Session {
  accessToken?: string;
  linkId?: string;
  shortCode?: string;
}

function loadSession(): Session {
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveSession(session: Session) {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
}

function loadFixture(suite: string, name: string): { body?: Record<string, unknown> } {
  const p = path.join(__dirname, "fixtures", suite, `${name}.json`);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

async function request(
  method: string,
  url: string,
  body?: unknown,
  token?: string
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function pass(label: string, status: number) {
  console.log(`  PASS  [${status}] ${label}`);
}

function fail(label: string, status: number, data: unknown) {
  console.log(`  FAIL  [${status}] ${label}`);
  console.log("        ", JSON.stringify(data));
}

async function runAuth(base: string, session: Session) {
  console.log("\n--- auth ---");

  const suffix = Date.now().toString(36);
  const registerFixture = loadFixture("auth", "register");
  const registerBody = {
    ...(registerFixture.body as Record<string, unknown>),
    username: `testcdk_${suffix}`,
    email: `testcdk_${suffix}@example.com`,
  };
  let res = await request("POST", `${base}/api/auth/signup`, registerBody);
  if (res.status === 201 || res.status === 200) {
    const d = res.data as { accessToken?: string };
    if (d.accessToken) session.accessToken = d.accessToken;
    pass("POST /api/auth/signup", res.status);
  } else {
    fail("POST /api/auth/signup", res.status, res.data);
  }

  const loginFixture = loadFixture("auth", "login");
  const loginBody = {
    ...(loginFixture.body as Record<string, unknown>),
    email: `testcdk_${suffix}@example.com`,
  };
  res = await request("POST", `${base}/api/auth/login`, loginBody);
  if (res.status === 200) {
    const d = res.data as { accessToken?: string };
    if (d.accessToken) session.accessToken = d.accessToken;
    pass("POST /api/auth/login", res.status);
  } else {
    fail("POST /api/auth/login", res.status, res.data);
  }

  res = await request("GET", `${base}/api/auth/me`, undefined, session.accessToken);
  res.status === 200 ? pass("GET /api/auth/me", res.status) : fail("GET /api/auth/me", res.status, res.data);
}

async function runLinks(base: string, session: Session) {
  console.log("\n--- links ---");

  const createFixture = loadFixture("links", "create");
  let res = await request("POST", `${base}/api/links`, createFixture.body, session.accessToken);
  if (res.status === 201 || res.status === 200) {
    const d = res.data as { id?: string; shortCode?: string };
    if (d.id) session.linkId = d.id;
    if (d.shortCode) session.shortCode = d.shortCode;
    pass("POST /api/links", res.status);
  } else {
    fail("POST /api/links", res.status, res.data);
  }

  res = await request("GET", `${base}/api/links`, undefined, session.accessToken);
  res.status === 200 ? pass("GET /api/links", res.status) : fail("GET /api/links", res.status, res.data);

  if (session.shortCode) {
    res = await request("GET", `${base}/api/links/code/${session.shortCode}`);
    res.status === 200 ? pass(`GET /api/links/code/${session.shortCode}`, res.status) : fail(`GET /api/links/code/${session.shortCode}`, res.status, res.data);

    res = await request("POST", `${base}/api/links/code/${session.shortCode}/click`);
    res.status === 200 ? pass(`POST /api/links/code/${session.shortCode}/click`, res.status) : fail(`POST /api/links/code/${session.shortCode}/click`, res.status, res.data);
  }

  if (session.linkId) {
    const updateFixture = loadFixture("links", "update");
    res = await request("PUT", `${base}/api/links/${session.linkId}`, updateFixture.body, session.accessToken);
    res.status === 200 ? pass(`PUT /api/links/${session.linkId}`, res.status) : fail(`PUT /api/links/${session.linkId}`, res.status, res.data);

    res = await request("DELETE", `${base}/api/links/${session.linkId}`, undefined, session.accessToken);
    res.status === 204 ? pass(`DELETE /api/links/${session.linkId}`, res.status) : fail(`DELETE /api/links/${session.linkId}`, res.status, res.data);
    if (res.status === 204) {
      session.linkId = undefined;
      session.shortCode = undefined;
    }
  }
}

async function runPublic(base: string, _session: Session) {
  console.log("\n--- public ---");

  const profileFixture = loadFixture("public", "profile");
  const username = (profileFixture.body as { username?: string })?.username ?? "testuser";

  let res = await request("GET", `${base}/api/public/${username}`);
  res.status === 200 ? pass(`GET /api/public/${username}`, res.status) : fail(`GET /api/public/${username}`, res.status, res.data);

  res = await request("GET", `${base}/api/public/${username}/links`);
  res.status === 200 ? pass(`GET /api/public/${username}/links`, res.status) : fail(`GET /api/public/${username}/links`, res.status, res.data);
}

async function runHealth(base: string) {
  console.log("\n--- health ---");

  for (const route of ["/health", "/health/live", "/health/ready"]) {
    const res = await request("GET", `${base}${route}`);
    res.status === 200 ? pass(`GET ${route}`, res.status) : fail(`GET ${route}`, res.status, res.data);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const suite = args.find((a) => !a.startsWith("--")) ?? "all";
  const urlArg = args.find((a) => a.startsWith("--url="))?.slice(6) ?? args[args.indexOf("--url") + 1];
  const base = urlArg ?? "http://localhost:3000";

  console.log(`\nRunning suite: ${suite}  →  ${base}`);

  const session = loadSession();

  if (suite === "auth" || suite === "all") await runAuth(base, session);
  if (suite === "links" || suite === "all") await runLinks(base, session);
  if (suite === "public" || suite === "all") await runPublic(base, session);
  if (suite === "health" || suite === "all") await runHealth(base);

  saveSession(session);
  console.log("\nDone.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
