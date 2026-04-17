import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import type { AccountRecord } from "../src/types.js";
import { getAccountAuthPath } from "../src/lib/paths.js";
import { UnsupportedCredentialStoreError, UsageFetchError } from "../src/lib/errors.js";
import { getCodexAuthPath, getCodexConfigPath } from "../src/lib/paths.js";
import {
  createUsageFetchContext,
  readUsageAccessToken,
  resolveUsageAuthPath,
  requestUsagePayload,
} from "../src/services/usage-fetch.js";
import { saveState } from "../src/state/store.js";
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

describe("usage-fetch helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("uses the stored auth path for non-current accounts", async () => {
    await withTempHome(async (homeDir) => {
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

      await expect(resolveUsageAuthPath(account)).resolves.toBe(account.authPath);
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

      await mkdir(dirname(getCodexAuthPath()), { recursive: true });
      await writeFile(getCodexAuthPath(), JSON.stringify({
        tokens: {
          account_id: "acct-current",
          access_token: "token-current",
        },
      }), "utf8");

      await expect(resolveUsageAuthPath(currentAccount)).resolves.toBe(getCodexAuthPath());
    });
  });

  test("createUsageFetchContext returns null activeAuthPath when auth.json is missing in auto mode", async () => {
    await withTempHome(async () => {
      const currentAccount = {
        ...createAccount("current@example.com", "profile-current", "acct-current"),
        profileId: "profile-current",
      };

      await saveState({
        currentProfileId: "profile-current",
        accounts: { "profile-current": currentAccount },
      });

      // No config.toml, no live auth.json: simulates Codex Desktop logout in
      // the default "auto" credential store mode.
      await expect(createUsageFetchContext(currentAccount)).resolves.toEqual({
        currentProfileId: "profile-current",
        activeAuthPath: null,
      });
    });
  });

  test("createUsageFetchContext throws when config selects keyring storage", async () => {
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

      await expect(createUsageFetchContext(currentAccount)).rejects.toBeInstanceOf(
        UnsupportedCredentialStoreError,
      );
    });
  });

  test("resolveUsageAuthPath falls back to managed path when live auth.json is missing", async () => {
    await withTempHome(async () => {
      const currentAccount = {
        ...createAccount("current@example.com", "profile-current", "acct-current"),
        profileId: "profile-current",
      };

      await saveState({
        currentProfileId: "profile-current",
        accounts: { "profile-current": currentAccount },
      });

      // No live auth.json on disk: resolveUsageAuthPath should degrade to the
      // managed snapshot path so usage queries can still serve the account.
      await expect(resolveUsageAuthPath(currentAccount)).resolves.toBe(currentAccount.authPath);
    });
  });

  test("throws an unauthorized usage error for HTTP 401 responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));

    await expect(requestUsagePayload("token")).rejects.toMatchObject<Partial<UsageFetchError>>({
      code: "unauthorized",
    });
  });

  test("reads the access token from the resolved auth state", async () => {
    await withTempHome(async () => {
      const account = createAccount("stored@example.com", "profile-stored", "acct-stored");
      await mkdir(dirname(account.authPath), { recursive: true });
      await writeFile(account.authPath, JSON.stringify({
        tokens: {
          account_id: "acct-stored",
          access_token: "token-stored",
        },
      }), "utf8");

      await expect(readUsageAccessToken(account, {
        currentProfileId: null,
        activeAuthPath: null,
      })).resolves.toBe("token-stored");
    });
  });
});
