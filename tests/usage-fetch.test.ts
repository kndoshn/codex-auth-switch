import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import type { AccountRecord } from "../src/types.js";
import { getAccountAuthPath } from "../src/lib/paths.js";
import { UsageFetchError } from "../src/lib/errors.js";
import { getCodexAuthPath } from "../src/lib/paths.js";
import { resolveUsageAuthPath, requestUsagePayload } from "../src/services/usage-fetch.js";
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

  test("throws an unauthorized usage error for HTTP 401 responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));

    await expect(requestUsagePayload("token")).rejects.toMatchObject<Partial<UsageFetchError>>({
      code: "unauthorized",
    });
  });
});
