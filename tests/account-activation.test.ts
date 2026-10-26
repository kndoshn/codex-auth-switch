import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, test } from "vitest";

import type { AppState } from "../src/types.js";
import { readAuthSnapshot, restoreAuthSnapshot } from "../src/lib/auth.js";
import { syncCurrentActiveAccountSnapshot } from "../src/services/account-activation.js";
import { withTempHome } from "./helpers/home.js";

describe("auth snapshot and activation helpers", () => {
  test("returns null when the previous auth file is missing", async () => {
    await withTempHome(async (homeDir) => {
      await expect(readAuthSnapshot(join(homeDir, "missing.json"))).resolves.toBeNull();
    });
  });

  test("restores previous auth content when rollback has a snapshot", async () => {
    await withTempHome(async (homeDir) => {
      const authPath = join(homeDir, "auth.json");
      await mkdir(dirname(authPath), { recursive: true });
      await writeFile(authPath, "new-auth", "utf8");

      await restoreAuthSnapshot(authPath, "previous-auth");

      await expect(readFile(authPath, "utf8")).resolves.toBe("previous-auth");
    });
  });

  test("removes the auth file when rollback has no previous snapshot", async () => {
    await withTempHome(async (homeDir) => {
      const authPath = join(homeDir, "auth.json");
      await mkdir(dirname(authPath), { recursive: true });
      await writeFile(authPath, "new-auth", "utf8");

      await restoreAuthSnapshot(authPath, null);

      await expect(readFile(authPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  test("returns the state unchanged when there is no current account", async () => {
    await withTempHome(async (homeDir) => {
      const state: AppState = {
        currentProfileId: null,
        accounts: {},
      };

      const result = await syncCurrentActiveAccountSnapshot(state, join(homeDir, "auth.json"));

      expect(result).toEqual({
        state,
        previousAuth: null,
      });
    });
  });
});
