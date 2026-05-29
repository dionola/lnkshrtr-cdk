import bcrypt from "bcryptjs";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { authRepository } from "./auth.repository";
import { signupSchema, loginSchema } from "./auth.validator";
import { signToken } from "../../../shared/utils/jwt";
import { AppError } from "../../../shared/utils/errors";
import { ok, redirect, handleError } from "../../../shared/utils/response";
import { env } from "./env";
import { logger } from "../../../shared/logger";
import type { UserResponse, AuthResponse } from "../../../shared/types";

function toUserResponse(user: {
  id: string;
  username: string;
  email: string;
  createdAt: Date;
}): UserResponse {
  return { id: user.id, username: user.username, email: user.email, createdAt: user.createdAt };
}

export async function signup(event: APIGatewayProxyEventV2) {
  const body = signupSchema.parse(JSON.parse(event.body ?? "{}"));

  const [existingEmail, existingUsername] = await Promise.all([
    authRepository.findByEmail(body.email),
    authRepository.findByUsername(body.username),
  ]);

  if (existingEmail) throw new AppError(409, "CONFLICT", "Email is already taken");
  if (existingUsername) throw new AppError(409, "CONFLICT", "Username is already taken");

  const hashedPassword = await bcrypt.hash(body.password, env.BCRYPT_ROUNDS);
  const user = await authRepository.create({
    email: body.email,
    username: body.username,
    password: hashedPassword,
  });

  const accessToken = signToken(user.id);
  logger.info("User registered", { userId: user.id });

  const response: AuthResponse = { user: toUserResponse(user), accessToken };
  return ok(response, 201);
}

export async function login(event: APIGatewayProxyEventV2) {
  const body = loginSchema.parse(JSON.parse(event.body ?? "{}"));

  const user = await authRepository.findByEmail(body.email);
  if (!user || !user.password) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid credentials");
  }

  const valid = await bcrypt.compare(body.password, user.password);
  if (!valid) throw new AppError(401, "UNAUTHORIZED", "Invalid credentials");

  const accessToken = signToken(user.id);
  logger.info("User logged in", { userId: user.id });

  const response: AuthResponse = { user: toUserResponse(user), accessToken };
  return ok(response);
}

export async function me(event: APIGatewayProxyEventV2) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userId = (event.requestContext as any).authorizer?.lambda?.userId as string;
  const user = await authRepository.findById(userId);
  if (!user) throw new AppError(401, "UNAUTHORIZED", "User not found");
  return ok(toUserResponse(user));
}

export async function googleInit(_event: APIGatewayProxyEventV2) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CALLBACK_URL) {
    throw new AppError(501, "NOT_IMPLEMENTED", "Google OAuth is not configured");
  }

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_CALLBACK_URL,
    response_type: "code",
    scope: "email profile",
    access_type: "offline",
  });

  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

export async function googleCallback(event: APIGatewayProxyEventV2) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_CALLBACK_URL) {
    throw new AppError(501, "NOT_IMPLEMENTED", "Google OAuth is not configured");
  }

  const code = event.queryStringParameters?.code;
  if (!code) throw new AppError(400, "BAD_REQUEST", "Missing OAuth code");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_CALLBACK_URL,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) throw new AppError(401, "UNAUTHORIZED", "Failed to exchange OAuth code");

  const { access_token } = await tokenRes.json() as { access_token: string };

  const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!userInfoRes.ok) throw new AppError(401, "UNAUTHORIZED", "Failed to fetch Google user info");

  const { email, name } = await userInfoRes.json() as { email: string; name?: string };

  let user = await authRepository.findByEmail(email);

  if (!user) {
    const baseUsername = (name ?? email.split("@")[0])
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");

    let username = baseUsername;
    let suffix = 1;
    while (await authRepository.findByUsername(username)) {
      username = `${baseUsername}_${suffix++}`;
    }

    user = await authRepository.create({ email, username, password: null });
  }

  const accessToken = signToken(user.id);
  logger.info("Google OAuth login", { userId: user.id });

  return redirect(`${env.FRONTEND_URL}/auth/callback?token=${accessToken}`);
}

export { handleError };
