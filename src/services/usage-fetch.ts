import type { AccountRecord, UsageResult, UsageSnapshot } from "../types.js";
import { UnsupportedCredentialStoreError } from "../lib/errors.js";
import { logDebug, logWarn } from "../lib/log.js";
import { toUsageFailure, toUsageSnapshot } from "../lib/usage.js";
import {
  createUsageFetchContext,
  readUsageAuthState,
  refreshUsageAuthAfterUnauthorized,
  refreshUsageAuthIfStale,
  resolveUsageAuthPath,
  type UsageFetchContext,
} from "./usage-auth.js";
import { requestUsagePayload } from "./usage-endpoint.js";

export { createUsageFetchContext, resolveUsageAuthPath } from "./usage-auth.js";
export { requestUsagePayload } from "./usage-endpoint.js";

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
  let usageAuth = await readUsageAuthState(account, context);
  usageAuth = await refreshUsageAuthIfStale(account, usageAuth);

  let rawResponse: unknown;
  try {
    rawResponse = await requestUsagePayload(usageAuth.auth.accessToken);
  } catch (error) {
    const refreshedUsageAuth = await refreshUsageAuthAfterUnauthorized(account, usageAuth, error);
    if (refreshedUsageAuth) {
      usageAuth = refreshedUsageAuth;
      rawResponse = await requestUsagePayload(usageAuth.auth.accessToken);
    } else {
      throw error;
    }
  }

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
  const usageAuth = await readUsageAuthState(account, context);
  return usageAuth.auth.accessToken;
}
