import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { describe, expect, test } from "vitest";

import { StateCorruptionError, StateReadError, StateWriteError } from "../src/lib/errors.js";
import { getAccountAuthPath, getStatePath } from "../src/lib/paths.js";
import { loadState, saveState } from "../src/state/store.js";
import { withTempHome } from "./helpers/home.js";

describe("state store", () => {
  test("returns an empty state when the file does not exist", async () => {
    await withTempHome(async () => {
      await expect(loadState()).resolves.toEqual({
        currentProfileId: null,
        accounts: {},
      });
    });
  });

  test("throws a typed error for invalid state JSON", async () => {
    await withTempHome(async () => {
      const statePath = getStatePath();
      await mkdir(dirname(statePath), { recursive: true });
      await writeFile(statePath, "{invalid", "utf8");

      await expect(loadState()).rejects.toBeInstanceOf(StateCorruptionError);
    });
  });

  test("throws a typed error when the state path cannot be read as a file", async () => {
    await withTempHome(async () => {
      const statePath = getStatePath();
      await mkdir(statePath, { recursive: true });

      await expect(loadState()).rejects.toBeInstanceOf(StateReadError);
    });
  });

  test("saves and reloads the validated state", async () => {
    await withTempHome(async () => {
      const authPath = getAccountAuthPath("profile-1");
      const state = {
        currentProfileId: "profile-1",
        accounts: {
          "profile-1": {
            profileId: "profile-1",
            email: "foo@example.com",
            accountId: "acct-1",
            authPath,
            createdAt: "2026-04-04T00:00:00.000Z",
            lastUsedAt: "2026-04-04T00:00:00.000Z",
          },
        },
      };

      await saveState(state);
      await expect(loadState()).resolves.toEqual(state);
    });
  });

  test("normalizes a legacy authPath to the derived managed auth path", async () => {
    await withTempHome(async () => {
      const statePath = getStatePath();
      await mkdir(dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify({
        currentProfileId: "profile-1",
        accounts: {
          "profile-1": {
            profileId: "profile-1",
            email: "foo@example.com",
            accountId: "acct-1",
            authPath: "/tmp/tampered.json",
            createdAt: "2026-04-04T00:00:00.000Z",
            lastUsedAt: "2026-04-04T00:00:00.000Z",
          },
        },
      }), "utf8");

      await expect(loadState()).resolves.toEqual({
        currentProfileId: "profile-1",
        accounts: {
          "profile-1": {
            profileId: "profile-1",
            email: "foo@example.com",
            accountId: "acct-1",
            authPath: getAccountAuthPath("profile-1"),
            createdAt: "2026-04-04T00:00:00.000Z",
            lastUsedAt: "2026-04-04T00:00:00.000Z",
          },
        },
      });
    });
  });

  test("does not rewrite the state file permissions on load", async () => {
    await withTempHome(async () => {
      const statePath = getStatePath();
      await mkdir(dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify({
        currentProfileId: null,
        accounts: {},
      }), "utf8");
      await chmod(statePath, 0o644);

      await loadState();

      expect((await stat(statePath)).mode & 0o777).toBe(0o644);
    });
  });

  test("writes state without persisting authPath", async () => {
    await withTempHome(async () => {
      await saveState({
        currentProfileId: "profile-1",
        accounts: {
          "profile-1": {
            profileId: "profile-1",
            email: "foo@example.com",
            accountId: "acct-1",
            authPath: getAccountAuthPath("profile-1"),
            createdAt: "2026-04-04T00:00:00.000Z",
            lastUsedAt: "2026-04-04T00:00:00.000Z",
          },
        },
      });

      const raw = await readFile(getStatePath(), "utf8");
      expect(raw).not.toContain("\"authPath\"");
    });
  });

  test("rejects invalid state objects before writing", async () => {
    await withTempHome(async () => {
      await expect(saveState({
        currentProfileId: 1,
        accounts: {},
      } as never)).rejects.toBeInstanceOf(StateWriteError);
    });
  });

  test("wraps file system write failures when saving state", async () => {
    await withTempHome(async () => {
      const statePath = getStatePath();
      await mkdir(statePath, { recursive: true });

      await expect(saveState({
        currentProfileId: null,
        accounts: {},
      })).rejects.toBeInstanceOf(StateWriteError);
    });
  });
});
