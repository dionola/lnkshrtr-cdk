import { extendZodWithOpenApi, OpenAPIRegistry, OpenAPIGenerator } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { signupSchema, loginSchema } from "../../src/modules/auth/auth.validator";
import { createLinkSchema, updateLinkSchema, verifyPasswordSchema } from "../../src/modules/links/links.validator";
import { cwLogGroupUrl } from "./cloudwatch";

extendZodWithOpenApi(z);

// ── reusable response schemas ──────────────────────────────────────────────

const TokenResponse = z.object({ accessToken: z.string() });

const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  username: z.string(),
  createdAt: z.string(),
});

const LinkSchema = z.object({
  id: z.string(),
  shortCode: z.string(),
  originalUrl: z.string().url(),
  title: z.string().nullable(),
  isPublic: z.boolean(),
  isActive: z.boolean(),
  isPasswordProtected: z.boolean(),
  userId: z.string().nullable(),
  type: z.string(),
  visits: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const json = (schema: z.ZodTypeAny) => ({
  content: { "application/json": { schema } },
});

const err = (description: string) => ({
  description,
  ...json(ErrorSchema),
});

// ── spec builder ──────────────────────────────────────────────────────────

export function buildSpec(stage: string, region: string, apiEndpoint: string): object {
  const cw = (name: string) => ({
    externalDocs: { description: "CloudWatch logs", url: cwLogGroupUrl(region, stage, name) },
  });

  const registry = new OpenAPIRegistry();

  registry.registerComponent("securitySchemes", "BearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });

  const TokenResponseRef = registry.register("TokenResponse", TokenResponse);
  const UserRef = registry.register("User", UserSchema);
  const LinkRef = registry.register("Link", LinkSchema);
  const ErrorRef = registry.register("Error", ErrorSchema);

  // ── auth ──────────────────────────────────────────────────────────────

  registry.registerPath({
    method: "post",
    path: "/api/auth/signup",
    tags: ["Auth"],
    summary: "Register a new user",
    ...cw("auth-signup"),
    request: { body: { required: true, ...json(signupSchema) } },
    responses: {
      201: { description: "Created", ...json(TokenResponseRef) },
      400: err("Validation error"),
      409: err("Email or username already taken"),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/auth/login",
    tags: ["Auth"],
    summary: "Log in with email and password",
    ...cw("auth-login"),
    request: { body: { required: true, ...json(loginSchema) } },
    responses: {
      200: { description: "OK", ...json(TokenResponseRef) },
      401: err("Invalid credentials"),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/auth/me",
    tags: ["Auth"],
    summary: "Get the authenticated user",
    ...cw("auth-me"),
    security: [{ BearerAuth: [] }],
    responses: {
      200: { description: "OK", ...json(UserRef) },
      401: err("Unauthorized"),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/auth/google",
    tags: ["Auth"],
    summary: "Initiate Google OAuth flow",
    ...cw("auth-google"),
    responses: {
      302: { description: "Redirect to Google consent page" },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/auth/google/callback",
    tags: ["Auth"],
    summary: "Google OAuth callback — exchanges code, redirects to frontend",
    ...cw("auth-google-callback"),
    request: { query: z.object({ code: z.string() }) },
    responses: {
      302: { description: "Redirect to frontend with token" },
      401: err("OAuth failed"),
    },
  });

  // ── links ─────────────────────────────────────────────────────────────

  registry.registerPath({
    method: "get",
    path: "/api/links",
    tags: ["Links"],
    summary: "Get all links for the authenticated user",
    ...cw("links-get"),
    security: [{ BearerAuth: [] }],
    request: {
      query: z.object({ type: z.string().optional() }),
    },
    responses: {
      200: { description: "OK", ...json(z.array(LinkRef)) },
      401: err("Unauthorized"),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/links",
    tags: ["Links"],
    summary: "Create a link (auth optional — guest links allowed)",
    ...cw("links-create"),
    request: { body: { required: true, ...json(createLinkSchema) } },
    responses: {
      201: { description: "Created", ...json(LinkRef) },
      400: err("Validation error"),
    },
  });

  registry.registerPath({
    method: "put",
    path: "/api/links/{id}",
    tags: ["Links"],
    summary: "Update a link",
    ...cw("links-update"),
    security: [{ BearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: { required: true, ...json(updateLinkSchema) },
    },
    responses: {
      200: { description: "OK", ...json(LinkRef) },
      401: err("Unauthorized"),
      404: err("Not found"),
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/api/links/{id}",
    tags: ["Links"],
    summary: "Delete a link",
    ...cw("links-delete"),
    security: [{ BearerAuth: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      204: { description: "Deleted" },
      401: err("Unauthorized"),
      404: err("Not found"),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/links/code/{shortCode}",
    tags: ["Links"],
    summary: "Get a link by its short code",
    ...cw("links-get-by-code"),
    request: { params: z.object({ shortCode: z.string() }) },
    responses: {
      200: { description: "OK", ...json(LinkRef) },
      404: err("Not found"),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/links/code/{shortCode}",
    tags: ["Links"],
    summary: "Verify a password-protected link",
    ...cw("links-verify-password"),
    request: {
      params: z.object({ shortCode: z.string() }),
      body: { required: true, ...json(verifyPasswordSchema) },
    },
    responses: {
      200: { description: "Password correct", ...json(LinkRef) },
      401: err("Incorrect password"),
      404: err("Not found"),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/links/code/{shortCode}/click",
    tags: ["Links"],
    summary: "Record a click on a link",
    ...cw("links-record-click"),
    request: { params: z.object({ shortCode: z.string() }) },
    responses: {
      200: { description: "OK", ...json(z.object({ success: z.boolean() })) },
      404: err("Not found"),
    },
  });

  // ── public ────────────────────────────────────────────────────────────

  registry.registerPath({
    method: "get",
    path: "/api/public/{username}",
    tags: ["Public"],
    summary: "Get a user's public profile",
    ...cw("public-profile"),
    request: { params: z.object({ username: z.string() }) },
    responses: {
      200: { description: "OK", ...json(UserRef) },
      404: err("Not found"),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/public/{username}/links",
    tags: ["Public"],
    summary: "Get a user's public links",
    ...cw("public-links"),
    request: { params: z.object({ username: z.string() }) },
    responses: {
      200: { description: "OK", ...json(z.array(LinkRef)) },
      404: err("Not found"),
    },
  });

  // ── health ────────────────────────────────────────────────────────────

  registry.registerPath({
    method: "get",
    path: "/health",
    tags: ["Health"],
    summary: "Basic health check",
    ...cw("health"),
    responses: {
      200: { description: "OK", ...json(z.object({ status: z.literal("ok") })) },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/health/live",
    tags: ["Health"],
    summary: "Liveness — confirms the Lambda is running",
    ...cw("health-live"),
    responses: {
      200: {
        description: "OK",
        ...json(z.object({ status: z.literal("ok"), uptime: z.number() })),
      },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/health/ready",
    tags: ["Health"],
    summary: "Readiness — checks DB and Redis connectivity",
    ...cw("health-ready"),
    responses: {
      200: {
        description: "Ready",
        ...json(z.object({ status: z.literal("ok"), db: z.literal("ok"), cache: z.string() })),
      },
      503: { description: "Not ready", ...json(ErrorRef) },
    },
  });

  // ── generate ──────────────────────────────────────────────────────────

  const generator = new OpenAPIGenerator(registry.definitions, "3.0.0");
  return generator.generateDocument({
    info: {
      title: "lnkshrtr API",
      version: "1.0.0",
      description: `Stage: **${stage}** · Region: **${region}**`,
    },
    servers: apiEndpoint ? [{ url: apiEndpoint }] : [],
  });
}
