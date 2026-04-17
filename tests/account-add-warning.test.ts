import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { getCodexAuthPath } from "../src/lib/paths.js";
import { withTempHome } from "./helpers/home.js";

type FsPromisesModule = typeof import("node:fs/promises");

describe("account-add warning branches", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("logs a warning when temporary CODEX_HOME cleanup fails", async () => {
    vi.stubEnv("CODEX_AUTH_SWITCH_LOG_LEVEL", "warn");
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { addAccountWithLogin, stateStore } = await loadAccountAddModule({
      rmImpl: async (actualRm, path, options) => {
        if (String(path).includes("codex-auth-switch-add-")) {
          throw new Error("cleanup denied");
        }
        return actualRm(path, options);
      },
      execaImpl: async (_command, _args, options: { env?: NodeJS.ProcessEnv }) => {
        const homeDir = options.env?.CODEX_HOME;
        if (!homeDir) {
          throw new Error("Expected CODEX_HOME to be set.");
        }

        const authPath = join(homeDir, "auth.json");
        await mkdir(dirname(authPath), { recursive: true });
        await writeFile(authPath, JSON.stringify({
          auth_mode: "chatgpt",
          OPENAI_API_KEY: null,
          tokens: {
            account_id: "acct-added",
            access_token: "token-added",
          },
        }), "utf8");

        return { exitCode: 0 };
      },
    });

    await withTempHome(async () => {
      await stateStore.saveState({
        currentProfileId: null,
        accounts: {},
      });

      await expect(addAccountWithLogin("foo@example.com")).resolves.toMatchObject({
        email: "foo@example.com",
        accountId: "acct-added",
      });
    });

    const logOutput = stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(logOutput).toContain("\"event\":\"account.add.temp_home.cleanup_failed\"");
    expect(logOutput).toContain("\"level\":\"warn\"");
  });

  test("logs a warning when managed auth cleanup fails during rollback", async () => {
    vi.stubEnv("CODEX_AUTH_SWITCH_LOG_LEVEL", "warn");
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { persistRegisteredAccount, stateStore } = await loadAccountAddModule({
      rmImpl: async (actualRm, path, options) => {
        if (String(path).includes("/accounts/") && !String(path).endsWith(".tmp")) {
          throw new Error("managed cleanup denied");
        }
        return actualRm(path, options);
      },
    });

    await withTempHome(async () => {
      await stateStore.saveState({
        currentProfileId: "profile-current",
        accounts: {
          "profile-current": {
            profileId: "profile-current",
            email: "current@example.com",
            accountId: "acct-current",
            authPath: "/tmp/current.json",
            createdAt: "2026-04-04T00:00:00.000Z",
            lastUsedAt: "2026-04-04T00:00:00.000Z",
          },
        },
      });

      vi.spyOn(stateStore, "saveState").mockRejectedValueOnce(new Error("disk full"));

      await expect(persistRegisteredAccount("foo@example.com", {
        raw: JSON.stringify({
          tokens: {
            account_id: "acct-foo",
            access_token: "token-foo",
          },
        }),
        accountId: "acct-foo",
        accessToken: "token-foo",
        refreshToken: null,
        lastRefresh: null,
      })).rejects.toThrow("disk full");
    });

    const logOutput = stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(logOutput).toContain("\"event\":\"account.add.rollback.cleanup_failed\"");
    expect(logOutput).toContain("\"level\":\"warn\"");
  });

  test("logs a warning when restoring the active auth file fails during rollback", async () => {
    vi.stubEnv("CODEX_AUTH_SWITCH_LOG_LEVEL", "warn");
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const { persistRegisteredAccount, stateStore } = await loadAccountAddModule({
      rmImpl: async (actualRm, path, options) => {
        if (String(path) === getCodexAuthPath()) {
          throw new Error("active auth restore denied");
        }
        return actualRm(path, options);
      },
    });

    await withTempHome(async () => {
      await stateStore.saveState({
        currentProfileId: null,
        accounts: {},
      });

      vi.spyOn(stateStore, "saveState").mockRejectedValueOnce(new Error("disk full"));

      await expect(persistRegisteredAccount("foo@example.com", {
        raw: JSON.stringify({
          tokens: {
            account_id: "acct-foo",
            access_token: "token-foo",
          },
        }),
        accountId: "acct-foo",
        accessToken: "token-foo",
        refreshToken: null,
        lastRefresh: null,
      })).rejects.toThrow("disk full");
    });

    const logOutput = stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(logOutput).toContain("\"event\":\"account.add.rollback.active_auth_restore_failed\"");
    expect(logOutput).toContain("\"level\":\"warn\"");
  });
});

async function loadAccountAddModule(options: {
  rmImpl: (
    actualRm: FsPromisesModule["rm"],
    path: Parameters<FsPromisesModule["rm"]>[0],
    options?: Parameters<FsPromisesModule["rm"]>[1],
  ) => ReturnType<FsPromisesModule["rm"]>;
  execaImpl?: (
    command: string,
    args: string[],
    options: { env?: NodeJS.ProcessEnv },
  ) => Promise<{ exitCode: number }>;
}): Promise<{
  addAccountWithLogin: typeof import("../src/services/account-add.js").addAccountWithLogin;
  persistRegisteredAccount: typeof import("../src/services/account-add.js").persistRegisteredAccount;
  stateStore: typeof import("../src/state/store.js");
}> {
  vi.doMock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<FsPromisesModule>();
    return {
      ...actual,
      rm: vi.fn(async (
        path: Parameters<FsPromisesModule["rm"]>[0],
        rmOptions?: Parameters<FsPromisesModule["rm"]>[1],
      ) => options.rmImpl(actual.rm, path, rmOptions)),
    };
  });

  vi.doMock("execa", () => ({
    execa: vi.fn(options.execaImpl ?? (async () => ({ exitCode: 0 }))),
  }));

  const accountAdd = await import("../src/services/account-add.js");
  const stateStore = await import("../src/state/store.js");

  return {
    addAccountWithLogin: accountAdd.addAccountWithLogin,
    persistRegisteredAccount: accountAdd.persistRegisteredAccount,
    stateStore,
  };
}
