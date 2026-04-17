import { readFile } from "node:fs/promises";

import { AuthReadError, AuthWriteError } from "./errors.js";
import { isFileNotFoundError, writeFileAtomic } from "./fs.js";
import { logDebug, logError, logWarn } from "./log.js";
import type { StoredAuthFile } from "../types.js";

export async function readAuthFile(path: string): Promise<StoredAuthFile> {
  logDebug("auth.read.start", "Reading auth file.", { path });
  try {
    const raw = await requireAuthRaw(path);
    const metadata = extractAuthMetadata(raw);
    const auth = {
      raw,
      accountId: metadata.accountId,
      accessToken: metadata.accessToken,
      refreshToken: metadata.refreshToken,
      lastRefresh: metadata.lastRefresh,
    };
    logDebug("auth.read.success", "Read auth file.", { path, accountId: auth.accountId });
    return auth;
  } catch (error) {
    if (error instanceof AuthReadError) {
      logWarn("auth.read.invalid", "Auth file could not be parsed.", {
        path,
        error,
      });
      throw error;
    }

    logError("auth.read.failure", "Failed to read auth file.", {
      path,
      error,
    });
    throw new AuthReadError(`Failed to read auth file: ${path}`, { cause: error });
  }
}

export async function readAccessTokenFile(path: string): Promise<string> {
  logDebug("auth.token.read.start", "Reading access token from auth file.", { path });
  try {
    const raw = await requireAuthRaw(path);
    const accessToken = extractAccessToken(raw);
    logDebug("auth.token.read.success", "Read access token from auth file.", { path });
    return accessToken;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      logWarn("auth.token.read.missing", "Auth file does not exist.", { path });
      throw error;
    }

    if (error instanceof AuthReadError) {
      logWarn("auth.token.read.invalid", "Access token could not be read from auth file.", {
        path,
        error,
      });
      throw error;
    }

    logError("auth.token.read.failure", "Failed to read access token from auth file.", {
      path,
      error,
    });
    throw new AuthReadError(`Failed to read auth file: ${path}`, { cause: error });
  }
}

export async function writeAuthFile(path: string, raw: string): Promise<void> {
  logDebug("auth.write.start", "Writing auth file.", { path });
  try {
    await writeFileAtomic(path, raw);
    logDebug("auth.write.success", "Wrote auth file.", { path });
  } catch (error) {
    logError("auth.write.failure", "Failed to write auth file.", {
      path,
      error,
    });
    throw new AuthWriteError(`Failed to write auth file: ${path}`, { cause: error });
  }
}

export function extractAccountId(raw: string): string {
  return extractAuthTokens(raw).accountId;
}

export function extractAccessToken(raw: string): string {
  return extractAuthTokens(raw).accessToken;
}

export function updateAuthFileTokens(
  raw: string,
  tokens: {
    accessToken?: string;
    refreshToken?: string;
    idToken?: string;
    lastRefresh?: string;
  },
): string {
  const document = parseAuthDocument(raw);
  const authTokens = document.tokens;

  if (tokens.accessToken !== undefined) {
    authTokens.access_token = tokens.accessToken;
  }

  if (tokens.refreshToken !== undefined) {
    authTokens.refresh_token = tokens.refreshToken;
  }

  if (tokens.idToken !== undefined) {
    authTokens.id_token = tokens.idToken;
  }

  if (tokens.lastRefresh !== undefined) {
    document.root.last_refresh = tokens.lastRefresh;
  }

  return JSON.stringify(document.root, null, 2);
}

function extractAuthTokens(raw: string): { accountId: string; accessToken: string } {
  const metadata = extractAuthMetadata(raw);
  return {
    accountId: metadata.accountId,
    accessToken: metadata.accessToken,
  };
}

function extractAuthMetadata(
  raw: string,
): { accountId: string; accessToken: string; refreshToken: string | null; lastRefresh: string | null } {
  const document = parseAuthDocument(raw);

  return {
    accountId: extractRequiredTokenString(document.tokens, "account_id", "account_id"),
    accessToken: extractRequiredTokenString(document.tokens, "access_token", "access token"),
    refreshToken: extractOptionalTokenString(document.tokens, "refresh_token"),
    lastRefresh: extractOptionalRootString(document.root, "last_refresh"),
  };
}

function extractRequiredTokenString(
  tokens: Record<string, unknown>,
  tokenKey: "account_id" | "access_token",
  label: string,
): string {
  const value = tokens[tokenKey];
  if (typeof value !== "string" || value.length === 0) {
    throw new AuthReadError(`Auth file is missing ${label}.`);
  }

  return value;
}

function extractOptionalTokenString(
  tokens: Record<string, unknown>,
  tokenKey: "refresh_token",
): string | null {
  const value = tokens[tokenKey];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function extractOptionalRootString(
  root: Record<string, unknown>,
  key: "last_refresh",
): string | null {
  const value = root[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseAuthDocument(raw: string): { root: Record<string, unknown>; tokens: Record<string, unknown> } {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new AuthReadError("Auth file is not valid JSON.", { cause: error });
  }

  if (!isRecord(parsed)) {
    throw new AuthReadError("Auth file is not an object.");
  }

  const tokens = parsed.tokens;
  if (!isRecord(tokens)) {
    throw new AuthReadError("Auth file is missing tokens.");
  }

  return {
    root: parsed,
    tokens,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requireAuthRaw(path: string): Promise<string> {
  return readFile(path, "utf8");
}
