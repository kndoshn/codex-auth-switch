import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  UsageAuthError,
  UsageFetchError,
} from "../src/lib/errors.js";
import {
  getAccountAuthPath,
  getCodexAuthPath,
} from "../src/lib/paths.js";
import {
  readUsageAuthState,
  refreshUsageAuthAfterUnauthorized,
  refreshUsageAuthIfStale,
  type UsageAuthState,
} from "../src/services/usage-auth.js";
import { saveState } from "../src/state/store.js";
import type { AccountRecord, StoredAuthFile } from "../src/types.js";
import { withTempHome } from "./helpers/home.js";

function createAccount(email: string, profileId: string, accountId: string): AccountRecord {
  return {
    profileId,
    email,
    accountId,
    authPath: getAccountAuthPath(profileId),
    createdAt: "2026-04-04T00:00:00.000Z",
    lastUsedAt: "2026-04-04T00:00:00.000Z",
  };
}

async function writeAuthPayload(
  authPath: string,
  options: {
    accountId: string;
    accessToken: string;
    refreshToken?: string;
    lastRefresh?: string;
  },
): Promise<void> {
  await mkdir(dirname(authPath), { recursive: true });
  await writeFile(authPath, JSON.stringify({
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    ...(options.lastRefresh ? { last_refresh: options.lastRefresh } : {}),
    tokens: {
      account_id: options.accountId,
      access_token: options.accessToken,
      ...(options.refreshToken ? { refresh_token: options.refreshToken } : {}),
    },
  }), "utf8");
}

function createUsageAuthState(overrides: Partial<UsageAuthState> = {}): UsageAuthState {
  const auth: StoredAuthFile = {
    raw: JSON.stringify({
      tokens: {
        account_id: "acct-1",
        access_token: "token-1",
        refresh_token: "refresh-1",
      },
    }),
    accountId: "acct-1",
    accessToken: "token-1",
    refreshToken: "refresh-1",
    lastRefresh: "2026-04-04T00:00:00.000Z",
  };

  return {
    authPath: "/tmp/auth.json",
    auth,
    isLiveAuth: false,
    ...overrides,
  };
}

describe("usage-auth helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("reads the live auth state for the current account", async () => {
    await withTempHome(async () => {
      const account = createAccount("current@example.com", "profile-current", "acct-current");
      await saveState({
        currentProfileId: account.profileId,
        accounts: { [account.profileId]: account },
      });
      await writeAuthPayload(getCodexAuthPath(), {
        accountId: "acct-current",
        accessToken: "token-live",
      });

      const state = await readUsageAuthState(account);

      expect(state).toMatchObject({
        authPath: getCodexAuthPath(),
        isLiveAuth: true,
        auth: {
          accountId: "acct-current",
          accessToken: "token-live",
        },
      });
    });
  });

  test("wraps malformed managed auth payloads as auth_invalid", async () => {
    await withTempHome(async () => {
      const account = createAccount("broken@example.com", "profile-broken", "acct-broken");
      await mkdir(dirname(account.authPath), { recursive: true });
      await writeFile(account.authPath, "{", "utf8");

      await expect(readUsageAuthState(account, {
        currentProfileId: null,
        activeAuthPath: null,
      })).rejects.toMatchObject<Partial<UsageAuthError>>({
        code: "auth_invalid",
      });
    });
  });

  test("does not refresh stale live auth state", async () => {
    const usageAuth = createUsageAuthState({
      isLiveAuth: true,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshUsageAuthIfStale(
      createAccount("live@example.com", "profile-live", "acct-1"),
      usageAuth,
    );

    expect(result).toBe(usageAuth);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("does not refresh when last_refresh is invalid", async () => {
    const usageAuth = createUsageAuthState({
      auth: {
        ...createUsageAuthState().auth,
        lastRefresh: "not-a-date",
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshUsageAuthIfStale(
      createAccount("stored@example.com", "profile-stored", "acct-1"),
      usageAuth,
    );

    expect(result).toBe(usageAuth);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("does not refresh when last_refresh is missing", async () => {
    const usageAuth = createUsageAuthState({
      auth: {
        ...createUsageAuthState().auth,
        lastRefresh: null,
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshUsageAuthIfStale(
      createAccount("stored@example.com", "profile-stored", "acct-1"),
      usageAuth,
    );

    expect(result).toBe(usageAuth);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("returns null for non-unauthorized retry errors", async () => {
    const usageAuth = createUsageAuthState();

    await expect(refreshUsageAuthAfterUnauthorized(
      createAccount("stored@example.com", "profile-stored", "acct-1"),
      usageAuth,
      new UsageFetchError("network_error", "boom"),
    )).resolves.toBeNull();
  });

  test("returns null for live auth even when the usage request was unauthorized", async () => {
    const usageAuth = createUsageAuthState({
      isLiveAuth: true,
    });

    await expect(refreshUsageAuthAfterUnauthorized(
      createAccount("live@example.com", "profile-live", "acct-1"),
      usageAuth,
      new UsageFetchError("unauthorized", "denied"),
    )).resolves.toBeNull();
  });

  test("returns a generic unauthorized error when the refresh failure body cannot be read", async () => {
    const account = createAccount("stored@example.com", "profile-stored", "acct-1");
    const usageAuth = createUsageAuthState();

    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 401,
      ok: false,
      text: async () => {
        throw new Error("stream closed");
      },
    }) satisfies Partial<Response> as Response));

    await expect(refreshUsageAuthAfterUnauthorized(
      account,
      usageAuth,
      new UsageFetchError("unauthorized", "denied"),
    )).rejects.toMatchObject<Partial<UsageFetchError>>({
      code: "unauthorized",
      message: "Saved session could not be refreshed. Please sign in again.",
    });
  });

  test("returns a generic unauthorized error when refresh failure body is a JSON array", async () => {
    const account = createAccount("stored@example.com", "profile-stored", "acct-1");
    const usageAuth = createUsageAuthState();

    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 401 })));

    await expect(refreshUsageAuthAfterUnauthorized(
      account,
      usageAuth,
      new UsageFetchError("unauthorized", "denied"),
    )).rejects.toMatchObject<Partial<UsageFetchError>>({
      code: "unauthorized",
      message: "Saved session could not be refreshed. Please sign in again.",
    });
  });

  test("wraps non-Error refresh network failures", async () => {
    const account = createAccount("stored@example.com", "profile-stored", "acct-1");
    const usageAuth = createUsageAuthState();

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw "offline";
    }));

    await expect(refreshUsageAuthAfterUnauthorized(
      account,
      usageAuth,
      new UsageFetchError("unauthorized", "denied"),
    )).rejects.toMatchObject<Partial<UsageFetchError>>({
      code: "network_error",
      message: "Failed to refresh saved session.",
    });
  });

  test("wraps Error JSON failures from the refresh endpoint", async () => {
    const account = createAccount("stored@example.com", "profile-stored", "acct-1");
    const usageAuth = createUsageAuthState();

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => Promise.reject(new Error("refresh payload parse failed")),
    }) satisfies Partial<Response> as Response));

    await expect(refreshUsageAuthAfterUnauthorized(
      account,
      usageAuth,
      new UsageFetchError("unauthorized", "denied"),
    )).rejects.toMatchObject<Partial<UsageFetchError>>({
      code: "malformed_response",
      message: "refresh payload parse failed",
    });
  });
});
