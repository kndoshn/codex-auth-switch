import type { AccountRecord, UsageResult, UsageSnapshot } from "../types.js";
import { deriveManagedAuthPath } from "../lib/account-record.js";
import { readAuthFile } from "../lib/auth.js";
import { resolveCodexAuthSource } from "../lib/codex-auth-source.js";
import { UnsupportedCredentialStoreError, UsageAuthError, UsageFetchError } from "../lib/errors.js";
import { ensureFileModeIfExists } from "../lib/fs.js";
import { logDebug, logWarn } from "../lib/log.js";
import { ensureManagedStoragePermissions } from "../lib/managed-storage.js";
import { getActiveCodexHome } from "../lib/paths.js";
import { toUsageFailure, toUsageSnapshot } from "../lib/usage.js";
import { mapUsageHttpFailure } from "../lib/usage-http.js";
import { loadState } from "../state/store.js";

const USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";

export type UsageFetchContext = {
  currentProfileId: string | null;
  activeAuthPath: string | null;
};

export async function fetchUsage(
  account: AccountRecord,
  context?: UsageFetchContext,
): Promise<UsageResult> {
  logDebug("usage.fetch.start", "Fetching usage for account.", {
    email: account.email,
    profileId: account.profileId,
  });
  try {
    const snapshot = await fetchUsageSnapshot(account, context);
    logDebug("usage.fetch.success", "Fetched usage for account.", {
      email: account.email,
      fetchedAt: snapshot.fetchedAt,
      planType: snapshot.planType,
    });

    return {
      email: account.email,
      ok: true,
      snapshot,
    };
  } catch (error) {
    if (error instanceof UnsupportedCredentialStoreError) {
      const failure = {
        code: "auth_invalid" as const,
        message: error.displayMessage,
      };
      logDebug("usage.fetch.failure", "Failed to fetch usage for account.", {
        email: account.email,
        code: failure.code,
        detail: failure.message,
      });
      return {
        email: account.email,
        ok: false,
        code: failure.code,
        error: failure.message,
      };
    }

    const failure = toUsageFailure(error);
    logDebug("usage.fetch.failure", "Failed to fetch usage for account.", {
      email: account.email,
      code: failure.code,
      detail: failure.message,
    });
    return {
      email: account.email,
      ok: false,
      code: failure.code,
      error: failure.message,
    };
  }
}

export async function fetchUsageSnapshot(
  account: AccountRecord,
  context?: UsageFetchContext,
): Promise<UsageSnapshot> {
  const accessToken = await readUsageAccessToken(account, context);
  const rawResponse = await requestUsagePayload(accessToken);
  const snapshot = toUsageSnapshot(rawResponse, account.email);

  if (snapshot.observedEmail && snapshot.observedEmail !== account.email) {
    logWarn("usage.identity.label_mismatch", "Usage endpoint email does not match the saved label.", {
      label: account.email,
      observedEmail: snapshot.observedEmail,
      profileId: account.profileId,
    });
  }

  if (snapshot.secondaryWindowIssue === "malformed") {
    logWarn(
      "usage.secondary_window.unavailable",
      "Usage endpoint did not return a usable secondary window for this account.",
      {
        email: account.email,
        profileId: account.profileId,
        planType: snapshot.planType,
      },
    );
  }

  return snapshot;
}

export async function readUsageAccessToken(
  account: AccountRecord,
  context?: UsageFetchContext,
): Promise<string> {
  const authPath = await resolveUsageAuthPath(account, context);
  try {
    if (authPath !== context?.activeAuthPath) {
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

    return auth.accessToken;
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

export async function requestUsagePayload(accessToken: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(USAGE_ENDPOINT, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (error) {
    logWarn("usage.http.network_failure", "Failed to reach usage endpoint.", {
      error,
    });
    if (error instanceof Error) {
      throw new UsageFetchError("network_error", error.message, { cause: error });
    }
    throw new UsageFetchError("network_error", "Failed to reach usage endpoint.");
  }

  logDebug("usage.http.response", "Received usage endpoint response.", {
    status: response.status,
    ok: response.ok,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      logWarn("usage.http.unauthorized", "Usage endpoint rejected the saved session.", {
        status: response.status,
      });
      throw new UsageFetchError("unauthorized", `Usage endpoint rejected the saved session: HTTP ${response.status}`);
    }

    const failure = mapUsageHttpFailure(response.status);
    logWarn(failure.event, failure.message, {
      status: response.status,
      code: failure.code,
    });
    throw new UsageFetchError(failure.code, `${failure.message}: HTTP ${response.status}`);
  }

  try {
    return await response.json();
  } catch (error) {
    logWarn("usage.http.invalid_json", "Usage endpoint returned invalid JSON.", {
      error,
    });
    if (error instanceof Error) {
      throw new UsageFetchError("malformed_response", error.message);
    }
    throw new UsageFetchError("malformed_response", "Usage endpoint returned invalid JSON.");
  }
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
