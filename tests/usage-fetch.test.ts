import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import type { AccountRecord } from "../src/types.js";
import { getAccountAuthPath } from "../src/lib/paths.js";
import { UnsupportedCredentialStoreError, UsageFetchError } from "../src/lib/errors.js";
import { getCodexAuthPath, getCodexConfigPath } from "../src/lib/paths.js";
import { createUsageFetchContext, readUsageAuthState } from "../src/services/usage-auth.js";
import { requestUsagePayload } from "../src/services/usage-endpoint.js";
import { saveState } from "../src/state/store.js";
import { withFileCodexHome as withTempHome } from "./helpers/home.js";

async function writeAuth(path: string, accountId: string, accessToken: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({
    tokens: {
      account_id: accountId,
      access_token: accessToken,
    },
  }), "utf8");
}

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

describe("usage-fetch helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("uses the stored auth path for non-current accounts", async () => {
    await withTempHome(async () => {
      const account = createAccount("stored@example.com", "profile-stored", "acct-stored");
      await saveState({
        currentProfileId: "another-profile",
        accounts: {
          "another-profile": {
            ...createAccount("other@example.com", "another-profile", "acct-other"),
            profileId: "another-profile",
          },
          [account.profileId]: account,
        },
      });
      await writeAuth(account.authPath, account.accountId, "token-stored");

      await expect(readUsageAuthState(account)).resolves.toMatchObject({
        authPath: account.authPath,
        isLiveAuth: false,
      });
    });
  });

  test("uses the active auth path for the current account", async () => {
    await withTempHome(async () => {
      const currentAccount = {
        ...createAccount("current@example.com", "profile-current", "acct-current"),
        profileId: "profile-current",
      };

      await saveState({
        currentProfileId: "profile-current",
        accounts: {
          "profile-current": currentAccount,
        },
      });

      await writeAuth(getCodexAuthPath(), "acct-current", "token-current");

      await expect(readUsageAuthState(currentAccount)).resolves.toMatchObject({
        authPath: getCodexAuthPath(),
        isLiveAuth: true,
        auth: expect.objectContaining({ accessToken: "token-current" }),
      });
    });
  });

  test("createUsageFetchContext returns null activeAuthPath when auth.json is missing in file mode", async () => {
    await withTempHome(async () => {
      const currentAccount = {
        ...createAccount("current@example.com", "profile-current", "acct-current"),
        profileId: "profile-current",
      };

      await saveState({
        currentProfileId: "profile-current",
        accounts: { "profile-current": currentAccount },
      });

      // Explicit file mode with missing live auth simulates desktop logout.
      await expect(createUsageFetchContext(currentAccount)).resolves.toEqual({
        currentProfileId: "profile-current",
        activeAuthPath: null,
      });
    });
  });

  test("createUsageFetchContext records an account-local error when config selects keyring storage", async () => {
    await withTempHome(async () => {
      const currentAccount = {
        ...createAccount("current@example.com", "profile-current", "acct-current"),
        profileId: "profile-current",
      };

      await saveState({
        currentProfileId: "profile-current",
        accounts: { "profile-current": currentAccount },
      });

      const configPath = getCodexConfigPath();
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, 'cli_auth_credentials_store = "keyring"\n', "utf8");

      await expect(createUsageFetchContext(currentAccount)).resolves.toMatchObject({
        activeAuthError: expect.any(UnsupportedCredentialStoreError),
      });
    });
  });

  test("falls back to the managed snapshot when live auth.json is missing", async () => {
    await withTempHome(async () => {
      const currentAccount = {
        ...createAccount("current@example.com", "profile-current", "acct-current"),
        profileId: "profile-current",
      };

      await saveState({
        currentProfileId: "profile-current",
        accounts: { "profile-current": currentAccount },
      });

      await writeAuth(currentAccount.authPath, "acct-current", "token-snapshot");

      // No live auth.json on disk: usage degrades to the managed snapshot so
      // queries can still serve the account.
      await expect(readUsageAuthState(currentAccount)).resolves.toMatchObject({
        authPath: currentAccount.authPath,
        isLiveAuth: false,
      });
    });
  });

  test("throws an unauthorized usage error for HTTP 401 responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));

    await expect(requestUsagePayload("token")).rejects.toMatchObject<Partial<UsageFetchError>>({
      code: "unauthorized",
    });
  });

  test("reads the access token from the provided context", async () => {
    await withTempHome(async () => {
      const account = createAccount("stored@example.com", "profile-stored", "acct-stored");
      await mkdir(dirname(account.authPath), { recursive: true });
      await writeFile(account.authPath, JSON.stringify({
        tokens: {
          account_id: "acct-stored",
          access_token: "token-stored",
        },
      }), "utf8");

      await expect(readUsageAuthState(account, {
        currentProfileId: null,
        activeAuthPath: null,
      })).resolves.toMatchObject({ auth: expect.objectContaining({ accessToken: "token-stored" }) });
    });
  });
});
