import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { describe, expect, test, vi } from "vitest";

import { getAccountsDir, getCodexAuthPath } from "../src/lib/paths.js";
import { persistRegisteredAccount } from "../src/services/account-add.js";
import * as stateStore from "../src/state/store.js";
import { withTempHome } from "./helpers/home.js";

describe("account-add helpers", () => {
  test("rolls back the managed auth file when state persistence fails", async () => {
    await withTempHome(async () => {
      await stateStore.saveState({
        currentProfileId: null,
        accounts: {},
      });

      const saveStateSpy = vi.spyOn(stateStore, "saveState").mockRejectedValueOnce(new Error("disk full"));

      await expect(persistRegisteredAccount("foo@example.com", {
        raw: JSON.stringify({
          tokens: {
            account_id: "acct-foo",
            access_token: "token-foo",
          },
        }),
        accountId: "acct-foo",
        accessToken: "token-foo",
      })).rejects.toThrow("disk full");

      await expect(readdir(getAccountsDir())).resolves.toEqual([]);
      saveStateSpy.mockRestore();
    });
  });

  test("restores the previous active auth when the first account fails to save", async () => {
    await withTempHome(async () => {
      await stateStore.saveState({
        currentProfileId: null,
        accounts: {},
      });

      const previousAuth = JSON.stringify({
        tokens: {
          account_id: "acct-existing",
          access_token: "token-existing",
        },
      });
      await mkdir(dirname(getCodexAuthPath()), { recursive: true });
      await writeFile(getCodexAuthPath(), previousAuth, "utf8");

      const saveStateSpy = vi.spyOn(stateStore, "saveState").mockRejectedValueOnce(new Error("disk full"));

      await expect(persistRegisteredAccount("foo@example.com", {
        raw: JSON.stringify({
          tokens: {
            account_id: "acct-foo",
            access_token: "token-foo",
          },
        }),
        accountId: "acct-foo",
        accessToken: "token-foo",
      })).rejects.toThrow("disk full");

      await expect(readFile(getCodexAuthPath(), "utf8")).resolves.toBe(previousAuth);
      await expect(readdir(getAccountsDir())).resolves.toEqual([]);
      saveStateSpy.mockRestore();
    });
  });
});
