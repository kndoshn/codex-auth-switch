import type { AccountRecord, StoredAuthFile } from "../types.js";
import { deriveManagedAuthPath } from "../lib/account-record.js";
import { readAuthFile, updateAuthFileTokens, writeAuthFile } from "../lib/auth.js";
import { resolveCodexAuthSource } from "../lib/codex-auth-source.js";
import { UnsupportedCredentialStoreError, UsageAuthError, UsageFetchError } from "../lib/errors.js";
import { ensureFileModeIfExists } from "../lib/fs.js";
import { logDebug, logWarn } from "../lib/log.js";
import { ensureManagedStoragePermissions } from "../lib/managed-storage.js";
import { getActiveCodexHome } from "../lib/paths.js";
import { loadState } from "../state/store.js";

const REFRESH_TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";
const REFRESH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const TOKEN_REFRESH_INTERVAL_DAYS = 8;

export type UsageFetchContext = {
  currentProfileId: string | null;
  activeAuthPath: string | null;
};

export type UsageAuthState = {
  authPath: string;
  auth: StoredAuthFile;
  isLiveAuth: boolean;
};

export async function readUsageAuthState(
  account: AccountRecord,
  context?: UsageFetchContext,
): Promise<UsageAuthState> {
  const resolvedContext = context ?? await createUsageFetchContext(account);
  const activeAuthPath = resolvedContext.activeAuthPath;
  const isLiveAuth =
    resolvedContext.currentProfileId === account.profileId
    && activeAuthPath !== null;
  const authPath = isLiveAuth ? activeAuthPath : deriveManagedAuthPath(account.profileId);
  try {
    if (!isLiveAuth) {
      await ensureManagedStoragePermissions();
      await ensureFileModeIfExists(authPath, 0o600);
    }
    const auth = await readAuthFile(authPath);
    if (auth.accountId !== account.accountId) {
      logWarn("usage.auth.mismatch", "Resolved auth file does not match the requested account.", {
        email: account.email,
        expectedAccountId: account.accountId,
        actualAccountId: auth.accountId,
      });
      throw new UsageAuthError("auth_mismatch", "Saved auth does not match the requested account.");
    }

    return {
      authPath,
      auth,
      isLiveAuth,
    };
  } catch (error) {
    if (error instanceof UsageAuthError) {
      throw error;
    }
    if (isNotFoundError(error)) {
      logWarn("usage.auth.missing", "Auth file is missing for usage fetch.", {
        email: account.email,
      });
      throw new UsageAuthError("auth_missing", "Saved auth file not found.");
    }
    logWarn("usage.auth.invalid", "Auth file is invalid for usage fetch.", {
      email: account.email,
      error,
    });
    throw new UsageAuthError("auth_invalid", "Saved auth file is invalid.", {
      cause: error,
    });
  }
}

export async function resolveUsageAuthPath(
  account: AccountRecord,
  context?: UsageFetchContext,
): Promise<string> {
  const resolvedContext = context ?? await createUsageFetchContext(account);
  if (resolvedContext.currentProfileId !== account.profileId || !resolvedContext.activeAuthPath) {
    return deriveManagedAuthPath(account.profileId);
  }

  return resolvedContext.activeAuthPath;
}

export async function createUsageFetchContext(
  ...accounts: readonly AccountRecord[]
): Promise<UsageFetchContext> {
  const state = await loadState();
  if (!state.currentProfileId || !accounts.some((account) => account.profileId === state.currentProfileId)) {
    return {
      currentProfileId: state.currentProfileId,
      activeAuthPath: null,
    };
  }

  const authSource = await resolveCodexAuthSource(getActiveCodexHome());
  if (authSource.resolvedMode === "keyring") {
    throw new UnsupportedCredentialStoreError(
      `Codex is configured to use ${authSource.configuredMode} credential storage in ${authSource.homeDir}.`,
    );
  }

  // resolvedMode === "unresolved" means auto mode and live auth.json is missing
  // (e.g., the user ran Logout in Codex Desktop). Fall back to managed
  // snapshots so usage queries can still serve every saved account.
  return {
    currentProfileId: state.currentProfileId,
    activeAuthPath: authSource.resolvedMode === "file" ? authSource.authPath : null,
  };
}

export async function refreshUsageAuthIfStale(
  account: AccountRecord,
  usageAuth: UsageAuthState,
): Promise<UsageAuthState> {
  if (usageAuth.isLiveAuth || !shouldRefreshAuth(usageAuth.auth.lastRefresh) || !usageAuth.auth.refreshToken) {
    return usageAuth;
  }

  try {
    return await refreshUsageAuth(account, usageAuth, "stale");
  } catch (error) {
    logWarn("usage.auth.refresh.stale_failed", "Failed to refresh a stale saved session before usage lookup.", {
      email: account.email,
      profileId: account.profileId,
      authPath: usageAuth.authPath,
      error,
    });
    return usageAuth;
  }
}

export async function refreshUsageAuthAfterUnauthorized(
  account: AccountRecord,
  usageAuth: UsageAuthState,
  error: unknown,
): Promise<UsageAuthState | null> {
  if (!canRefreshUsageAuthAfterUnauthorized(error, usageAuth)) {
    return null;
  }

  return refreshUsageAuth(account, usageAuth, "unauthorized");
}

async function refreshUsageAuth(
  account: AccountRecord,
  usageAuth: UsageAuthState,
  reason: "stale" | "unauthorized",
): Promise<UsageAuthState> {
  const refreshToken = usageAuth.auth.refreshToken;
  if (!refreshToken) {
    throw new UsageFetchError("unauthorized", "Saved session cannot be refreshed because refresh token is missing.");
  }

  logDebug("usage.auth.refresh.start", "Refreshing saved session before usage lookup.", {
    email: account.email,
    profileId: account.profileId,
    authPath: usageAuth.authPath,
    reason,
  });

  const refreshedTokens = await requestAuthRefresh(refreshToken);
  const nextRaw = updateAuthFileTokens(usageAuth.auth.raw, {
    accessToken: refreshedTokens.accessToken,
    refreshToken: refreshedTokens.refreshToken,
    ...(refreshedTokens.idToken ? { idToken: refreshedTokens.idToken } : {}),
    lastRefresh: new Date().toISOString(),
  });
  await writeAuthFile(usageAuth.authPath, nextRaw);

  logDebug("usage.auth.refresh.success", "Refreshed saved session before usage lookup.", {
    email: account.email,
    profileId: account.profileId,
    authPath: usageAuth.authPath,
    reason,
  });

  const refreshedAuth = await readAuthFile(usageAuth.authPath);
  if (refreshedAuth.accountId !== account.accountId) {
    throw new UsageAuthError("auth_mismatch", "Saved auth does not match the requested account.");
  }

  return {
    authPath: usageAuth.authPath,
    auth: refreshedAuth,
    isLiveAuth: usageAuth.isLiveAuth,
  };
}

async function requestAuthRefresh(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  idToken: string | null;
}> {
  let response: Response;
  try {
    response = await fetch(REFRESH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: REFRESH_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new UsageFetchError("network_error", error.message, { cause: error });
    }

    throw new UsageFetchError("network_error", "Failed to refresh saved session.");
  }

  if (response.status === 401) {
    const responseBody = await readResponseTextSafely(response);
    throw new UsageFetchError("unauthorized", getRefreshFailureMessage(responseBody));
  }

  if (!response.ok) {
    if (response.status >= 500) {
      throw new UsageFetchError("service_unavailable", `Failed to refresh saved session: HTTP ${response.status}`);
    }

    throw new UsageFetchError("endpoint_changed", `Failed to refresh saved session: HTTP ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (error instanceof Error) {
      throw new UsageFetchError("malformed_response", error.message);
    }

    throw new UsageFetchError("malformed_response", "Refresh endpoint returned invalid JSON.");
  }

  if (!isRefreshResponse(payload) || typeof payload.access_token !== "string" || payload.access_token.length === 0) {
    throw new UsageFetchError("malformed_response", "Refresh endpoint did not return a usable access token.");
  }

  return {
    accessToken: payload.access_token,
    refreshToken:
      typeof payload.refresh_token === "string" && payload.refresh_token.length > 0
        ? payload.refresh_token
        : refreshToken,
    idToken: typeof payload.id_token === "string" && payload.id_token.length > 0 ? payload.id_token : null,
  };
}

function shouldRefreshAuth(lastRefresh: string | null): boolean {
  if (!lastRefresh) {
    return false;
  }

  const lastRefreshTimestamp = Date.parse(lastRefresh);
  if (!Number.isFinite(lastRefreshTimestamp)) {
    return false;
  }

  return Date.now() - lastRefreshTimestamp >= TOKEN_REFRESH_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
}

function canRefreshUsageAuthAfterUnauthorized(error: unknown, usageAuth: UsageAuthState): boolean {
  return !usageAuth.isLiveAuth
    && usageAuth.auth.refreshToken !== null
    && error instanceof UsageFetchError
    && error.code === "unauthorized";
}

async function readResponseTextSafely(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function getRefreshFailureMessage(responseBody: string): string {
  const refreshFailureCode = extractRefreshFailureCode(responseBody);
  if (refreshFailureCode === "refresh_token_expired") {
    return "Saved session could not be refreshed because its refresh token expired. Please sign in again.";
  }

  if (refreshFailureCode === "refresh_token_reused") {
    return "Saved session could not be refreshed because its refresh token was already used. Please sign in again.";
  }

  if (refreshFailureCode === "refresh_token_invalidated") {
    return "Saved session could not be refreshed because its refresh token was revoked. Please sign in again.";
  }

  return "Saved session could not be refreshed. Please sign in again.";
}

function extractRefreshFailureCode(responseBody: string): string | null {
  if (responseBody.trim().length === 0) {
    return null;
  }

  try {
    const payload = JSON.parse(responseBody) as unknown;
    if (!isRecord(payload)) {
      return null;
    }

    const error = payload.error;
    if (isRecord(error) && typeof error.code === "string") {
      return error.code;
    }

    if (typeof error === "string") {
      return error;
    }

    return typeof payload.code === "string" ? payload.code : null;
  } catch {
    return null;
  }
}

function isRefreshResponse(
  payload: unknown,
): payload is { access_token?: unknown; refresh_token?: unknown; id_token?: unknown } {
  return isRecord(payload);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNotFoundError(error: unknown): boolean {
  if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
    return true;
  }

  if (error instanceof Error && "cause" in error) {
    return isNotFoundError(error.cause);
  }

  return false;
}
