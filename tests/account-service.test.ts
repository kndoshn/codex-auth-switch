import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";
import { vi } from "vitest";

import {
  AuthReadError,
  ActiveAccountRemovalError,
  CodexLoginFailedError,
  DuplicateAccountError,
  UnsupportedCredentialStoreError,
} from "../src/lib/errors.js";
import {
  activateAccount,
  addAccount,
  getAccountByEmail,
  getCurrentAccount,
  listAccounts,
  removeAccount,
} from "../src/services/account-service.js";
import { getAccountAuthPath, getCodexAuthPath, getCodexConfigPath } from "../src/lib/paths.js";
import * as stateStore from "../src/state/store.js";
import type { AccountRecord, AppState } from "../src/types.js";
import { withTempHome } from "./helpers/home.js";

const { execaMock } = vi.hoisted(() => ({
  execaMock: vi.fn(async () => ({
    exitCode: 0,
  })),
}));

const { assertNoRunningCodexProcessMock } = vi.hoisted(() => ({
  assertNoRunningCodexProcessMock: vi.fn(async () => undefined),
}));

vi.mock("../src/lib/process.js", () => ({
  assertNoRunningCodexProcess: assertNoRunningCodexProcessMock,
  findRunningCodexProcesses: vi.fn(async () => []),
}));

vi.mock("execa", () => ({
  execa: execaMock,
}));

function createAccountRecordFixture(
  profileId: string,
  email: string,
  accountId: string,
  authPath = getAccountAuthPath(profileId),
): AccountRecord {
  return {
    profileId,
    email,
    accountId,
    authPath,
    createdAt: "2026-04-04T00:00:00.000Z",
    lastUsedAt: "2026-04-04T00:00:00.000Z",
  };
}

function createStateFixture(
  currentProfileId: string | null,
  accounts: AccountRecord[],
): AppState {
  return {
    currentProfileId,
    accounts: Object.fromEntries(accounts.map((account) => [account.profileId, account])),
  };
}

function createAuthRaw(accountId: string, accessToken: string): string {
  return JSON.stringify({
    tokens: {
      account_id: accountId,
      access_token: accessToken,
    },
  });
}

async function writeAuthFixture(path: string, accountId: string, accessToken: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, createAuthRaw(accountId, accessToken), "utf8");
}

async function writeFileCredentialStoreConfig(): Promise<void> {
  const currentConfigPath = getCodexConfigPath();
  await mkdir(dirname(currentConfigPath), { recursive: true });
  await writeFile(currentConfigPath, 'cli_auth_credentials_store = "file"\n', "utf8");
}

describe("addAccount", () => {
  afterEach(() => {
    execaMock.mockReset();
    execaMock.mockResolvedValue({
      exitCode: 0,
    });
  });

  test("persists a successfully added account with a normalized email", async () => {
    execaMock.mockImplementationOnce(async (_command, _args, options: { env?: NodeJS.ProcessEnv }) => {
      const homeDir = options.env?.CODEX_HOME;
      if (!homeDir) {
        throw new Error("Expected CODEX_HOME to be set.");
      }

      const authPath = join(homeDir, "auth.json");
      await mkdir(dirname(authPath), { recursive: true });
      await writeFile(authPath, JSON.stringify({
        auth_mode: "chatgpt",
        OPENAI_API_KEY: null,
        last_refresh: "2026-04-04T00:00:00.000Z",
        tokens: {
          access_token: "token-added",
          account_id: "acct-added",
          refresh_token: "refresh-added",
          id_token: "id-added",
        },
      }), "utf8");

      return { exitCode: 0 };
    });

    await withTempHome(async () => {
      const account = await addAccount(" Foo@Example.com ");

      expect(account).toMatchObject({
        email: "foo@example.com",
        accountId: "acct-added",
      });

      const state = await stateStore.loadState();
      expect(state.currentProfileId).toBe(account.profileId);
      expect(Object.values(state.accounts)).toHaveLength(1);
      expect(Object.values(state.accounts)[0]).toMatchObject({
        email: "foo@example.com",
        accountId: "acct-added",
      });
      await expect(readFile(account.authPath, "utf8")).resolves.toContain("token-added");
    });
  });

  test("rejects duplicate emails before login", async () => {
    await withTempHome(async () => {
      await stateStore.saveState({
        currentProfileId: null,
        accounts: {
          profile_1: {
            profileId: "profile_1",
            email: "foo@example.com",
            accountId: "acct-1",
            authPath: "/tmp/profile_1.json",
            createdAt: "2026-04-04T00:00:00.000Z",
            lastUsedAt: "2026-04-04T00:00:00.000Z",
          },
        },
      });

      await expect(addAccount(" Foo@Example.com ")).rejects.toBeInstanceOf(DuplicateAccountError);
    });
  });

  test("fails fast when codex does not leave a readable auth file", async () => {
    await withTempHome(async () => {
      await expect(addAccount("foo@example.com")).rejects.toBeInstanceOf(
        UnsupportedCredentialStoreError,
      );
    });
  });

  test("wraps non-zero codex login exits in a typed error", async () => {
    execaMock.mockResolvedValueOnce({ exitCode: 9 });

    await withTempHome(async () => {
      await expect(addAccount("foo@example.com")).rejects.toBeInstanceOf(CodexLoginFailedError);
    });
  });

  test("wraps thrown codex login failures in a typed error", async () => {
    execaMock.mockRejectedValueOnce(new Error("spawn failed"));

    await withTempHome(async () => {
      await expect(addAccount("foo@example.com")).rejects.toBeInstanceOf(CodexLoginFailedError);
    });
  });
});

describe("account queries", () => {
  test("lists accounts sorted by email and returns the current profile id", async () => {
    await withTempHome(async () => {
      await stateStore.saveState({
        currentProfileId: "profile-b",
        accounts: {
          "profile-b": {
            profileId: "profile-b",
            email: "zeta@example.com",
            accountId: "acct-z",
            authPath: "/tmp/zeta.json",
            createdAt: "2026-04-04T00:00:00.000Z",
            lastUsedAt: "2026-04-04T00:00:00.000Z",
          },
          "profile-a": {
            profileId: "profile-a",
            email: "alpha@example.com",
            accountId: "acct-a",
            authPath: "/tmp/alpha.json",
            createdAt: "2026-04-04T00:00:00.000Z",
            lastUsedAt: "2026-04-04T00:00:00.000Z",
          },
        },
      });

      await expect(listAccounts()).resolves.toEqual({
        currentProfileId: "profile-b",
        accounts: [
          expect.objectContaining({ email: "alpha@example.com" }),
          expect.objectContaining({ email: "zeta@example.com" }),
        ],
      });
    });
  });

  test("normalizes email lookups when getting an account by email", async () => {
    await withTempHome(async () => {
      await stateStore.saveState({
        currentProfileId: null,
        accounts: {
          profile_1: {
            profileId: "profile_1",
            email: "foo@example.com",
            accountId: "acct-1",
            authPath: "/tmp/foo.json",
            createdAt: "2026-04-04T00:00:00.000Z",
            lastUsedAt: "2026-04-04T00:00:00.000Z",
          },
        },
      });

      await expect(getAccountByEmail(" Foo@Example.com ")).resolves.toMatchObject({
        email: "foo@example.com",
      });
    });
  });

  test("returns the current account", async () => {
    await withTempHome(async () => {
      await stateStore.saveState({
        currentProfileId: "profile_1",
        accounts: {
          profile_1: {
            profileId: "profile_1",
            email: "foo@example.com",
            accountId: "acct-1",
            authPath: "/tmp/foo.json",
            createdAt: "2026-04-04T00:00:00.000Z",
            lastUsedAt: "2026-04-04T00:00:00.000Z",
          },
        },
      });

      await expect(getCurrentAccount()).resolves.toMatchObject({
        email: "foo@example.com",
      });
    });
  });
});

describe("activateAccount", () => {
  test("skips syncing when the current stored auth already matches the active auth", async () => {
    await withTempHome(async () => {
      const currentAuthPath = getCodexAuthPath();
      const currentAccountAuthPath = getAccountAuthPath("profile-current");
      const targetAccountAuthPath = getAccountAuthPath("profile-target");

      const currentRaw = JSON.stringify({
        tokens: {
          account_id: "acct-current",
          access_token: "token-current-active",
        },
      });

      await mkdir(dirname(currentAuthPath), { recursive: true });
      await writeFile(currentAuthPath, currentRaw, "utf8");
      await mkdir(dirname(currentAccountAuthPath), { recursive: true });
      await writeFile(currentAccountAuthPath, currentRaw, "utf8");
      await mkdir(dirname(targetAccountAuthPath), { recursive: true });
      await writeFile(
        targetAccountAuthPath,
        JSON.stringify({
          tokens: {
            account_id: "acct-target",
            access_token: "token-target-stored",
          },
        }),
        "utf8",
      );

      await stateStore.saveState({
        currentProfileId: "profile-current",
        accounts: {
          "profile-current": {
            profileId: "profile-current",
            email: "current@example.com",
            accountId: "acct-current",
            authPath: currentAccountAuthPath,
            createdAt: "2026-04-04T00:00:00.000Z",
            lastUsedAt: "2026-04-04T00:00:00.000Z",
          },
          "profile-target": {
            profileId: "profile-target",
            email: "target@example.com",
            accountId: "acct-target",
            authPath: targetAccountAuthPath,
            createdAt: "2026-04-04T00:00:00.000Z",
            lastUsedAt: "2026-04-04T00:00:00.000Z",
          },
        },
      });

      await activateAccount("target@example.com");

      await expect(readFile(currentAccountAuthPath, "utf8")).resolves.toBe(currentRaw);
      await expect(readFile(currentAuthPath, "utf8")).resolves.toContain("token-target-stored");
    });
  });

  test("syncs the current active auth back before switching away", async () => {
    await withTempHome(async () => {
      const currentAuthPath = getCodexAuthPath();
      const currentAccountAuthPath = getAccountAuthPath("profile-current");
      const targetAccountAuthPath = getAccountAuthPath("profile-target");

      await mkdir(dirname(currentAuthPath), { recursive: true });
      await writeFile(
        currentAuthPath,
        JSON.stringify({
          tokens: {
            account_id: "acct-current",
            access_token: "token-current-active",
          },
        }),
        "utf8",
      );

      await mkdir(dirname(currentAccountAuthPath), { recursive: true });
      await writeFile(
        currentAccountAuthPath,
        JSON.stringify({
          tokens: {
            account_id: "acct-current",
            access_token: "token-current-stored",
          },
        }),
        "utf8",
      );

      await mkdir(dirname(targetAccountAuthPath), { recursive: true });
      await writeFile(
        targetAccountAuthPath,
        JSON.stringify({
          tokens: {
            account_id: "acct-target",
            access_token: "token-target-stored",
          },
        }),
        "utf8",
      );

      await stateStore.saveState({
        currentProfileId: "profile-current",
        accounts: {
          "profile-current": {
            profileId: "profile-current",
            email: "current@example.com",
            accountId: "acct-current",
            authPath: currentAccountAuthPath,
            createdAt: "2026-04-04T00:00:00.000Z",
            lastUsedAt: "2026-04-04T00:00:00.000Z",
          },
          "profile-target": {
            profileId: "profile-target",
            email: "target@example.com",
            accountId: "acct-target",
            authPath: targetAccountAuthPath,
            createdAt: "2026-04-04T00:00:00.000Z",
            lastUsedAt: "2026-04-04T00:00:00.000Z",
          },
        },
      });

      await activateAccount("target@example.com");

      await expect(readFile(currentAccountAuthPath, "utf8")).resolves.toContain("token-current-active");
      await expect(readFile(currentAuthPath, "utf8")).resolves.toContain("token-target-stored");
    });
  });

  test("fails when the current auth file exists but cannot be read", async () => {
    await withTempHome(async () => {
      const accountAuthPath = getAccountAuthPath("profile_1");
      await mkdir(dirname(accountAuthPath), { recursive: true });
      await writeFile(accountAuthPath, JSON.stringify({
        auth_mode: "chatgpt",
        OPENAI_API_KEY: null,
        last_refresh: "2026-04-04T00:00:00.000Z",
        tokens: {
          access_token: "token",
          account_id: "acct-1",
          refresh_token: "refresh",
          id_token: "id",
        },
      }), "utf8");

      await stateStore.saveState({
        currentProfileId: null,
        accounts: {
          profile_1: {
            profileId: "profile_1",
            email: "foo@example.com",
            accountId: "acct-1",
            authPath: accountAuthPath,
            createdAt: "2026-04-04T00:00:00.000Z",
            lastUsedAt: "2026-04-04T00:00:00.000Z",
          },
        },
      });

      const currentAuthPath = getCodexAuthPath();
      await mkdir(dirname(currentAuthPath), { recursive: true });
      await writeFile(currentAuthPath, "{}", "utf8");
      await chmod(currentAuthPath, 0o000);

      await expect(activateAccount("foo@example.com")).rejects.toBeInstanceOf(AuthReadError);

      await chmod(currentAuthPath, 0o600);
      await expect(stateStore.loadState()).resolves.toMatchObject({
        currentProfileId: null,
      });
    });
  });

  test("removes the written auth file when state persistence fails during activation with no previous auth", async () => {
    await withTempHome(async () => {
      const accountAuthPath = getAccountAuthPath("profile_1");
      await mkdir(dirname(accountAuthPath), { recursive: true });
      await writeFile(
        accountAuthPath,
        JSON.stringify({
          tokens: {
            account_id: "acct-1",
            access_token: "token-target",
          },
        }),
        "utf8",
      );

      await stateStore.saveState({
        currentProfileId: null,
        accounts: {
          profile_1: {
            profileId: "profile_1",
            email: "foo@example.com",
            accountId: "acct-1",
            authPath: accountAuthPath,
            createdAt: "2026-04-04T00:00:00.000Z",
            lastUsedAt: "2026-04-04T00:00:00.000Z",
          },
        },
      });

      const currentAuthPath = getCodexAuthPath();
      const currentConfigPath = getCodexConfigPath();
      await mkdir(dirname(currentConfigPath), { recursive: true });
      await writeFile(currentConfigPath, 'cli_auth_credentials_store = "file"\n', "utf8");
      const saveStateSpy = vi.spyOn(stateStore, "saveState").mockRejectedValueOnce(new Error("disk full"));

      await expect(activateAccount("foo@example.com")).rejects.toThrow("disk full");
      await expect(readFile(currentAuthPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });

      saveStateSpy.mockRestore();
    });
  });
});

describe("removeAccount", () => {
  afterEach(() => {
    assertNoRunningCodexProcessMock.mockReset();
    assertNoRunningCodexProcessMock.mockResolvedValue(undefined);
  });

  test("removes an inactive account from state and managed storage", async () => {
    await withTempHome(async () => {
      const currentAuthPath = getCodexAuthPath();
      const currentAccount = createAccountRecordFixture("profile-current", "current@example.com", "acct-current");
      const targetAccount = createAccountRecordFixture("profile-target", "target@example.com", "acct-target");

      await writeAuthFixture(currentAuthPath, "acct-current", "token-current-active");
      await writeAuthFixture(currentAccount.authPath, "acct-current", "token-current-stored");
      await writeAuthFixture(targetAccount.authPath, "acct-target", "token-target-stored");
      await stateStore.saveState(createStateFixture(currentAccount.profileId, [currentAccount, targetAccount]));

      await removeAccount("target@example.com");

      await expect(stateStore.loadState()).resolves.toEqual({
        currentProfileId: currentAccount.profileId,
        accounts: {
          [currentAccount.profileId]: expect.objectContaining({
            profileId: currentAccount.profileId,
            email: currentAccount.email,
          }),
        },
      });
      await expect(readFile(targetAccount.authPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(readFile(currentAuthPath, "utf8")).resolves.toContain("token-current-active");
      expect(assertNoRunningCodexProcessMock).not.toHaveBeenCalled();
    });
  });

  test("removes the sole active account and clears the active profile", async () => {
    await withTempHome(async () => {
      const currentAuthPath = getCodexAuthPath();
      const account = createAccountRecordFixture("profile-1", "foo@example.com", "acct-1");

      await writeFileCredentialStoreConfig();
      await writeAuthFixture(currentAuthPath, account.accountId, "token-active");
      await writeAuthFixture(account.authPath, account.accountId, "token-stored");
      await stateStore.saveState(createStateFixture(account.profileId, [account]));

      await removeAccount("foo@example.com");

      await expect(stateStore.loadState()).resolves.toEqual({
        currentProfileId: null,
        accounts: {},
      });
      await expect(readFile(account.authPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(readFile(currentAuthPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(assertNoRunningCodexProcessMock).toHaveBeenCalledTimes(1);
    });
  });

  test("refuses to remove the active account while other saved accounts remain", async () => {
    await withTempHome(async () => {
      const currentAuthPath = getCodexAuthPath();
      const currentAccount = createAccountRecordFixture("profile-current", "current@example.com", "acct-current");
      const targetAccount = createAccountRecordFixture("profile-target", "target@example.com", "acct-target");

      await writeAuthFixture(currentAuthPath, currentAccount.accountId, "token-current-active");
      await writeAuthFixture(currentAccount.authPath, currentAccount.accountId, "token-current-stored");
      await writeAuthFixture(targetAccount.authPath, targetAccount.accountId, "token-target-stored");
      await stateStore.saveState(createStateFixture(currentAccount.profileId, [currentAccount, targetAccount]));

      await expect(removeAccount("current@example.com")).rejects.toBeInstanceOf(ActiveAccountRemovalError);

      await expect(stateStore.loadState()).resolves.toMatchObject({
        currentProfileId: currentAccount.profileId,
      });
      await expect(readFile(currentAccount.authPath, "utf8")).resolves.toContain("token-current-stored");
      await expect(readFile(targetAccount.authPath, "utf8")).resolves.toContain("token-target-stored");
      await expect(readFile(currentAuthPath, "utf8")).resolves.toContain("token-current-active");
      expect(assertNoRunningCodexProcessMock).not.toHaveBeenCalled();
    });
  });

  test("restores the removed managed auth when state persistence fails for an inactive removal", async () => {
    await withTempHome(async () => {
      const currentAccount = createAccountRecordFixture("profile-current", "current@example.com", "acct-current");
      const targetAccount = createAccountRecordFixture("profile-target", "target@example.com", "acct-target");
      const targetRaw = createAuthRaw(targetAccount.accountId, "token-target-stored");

      await writeAuthFixture(currentAccount.authPath, currentAccount.accountId, "token-current-stored");
      await writeAuthFixture(targetAccount.authPath, targetAccount.accountId, "token-target-stored");
      await stateStore.saveState(createStateFixture(currentAccount.profileId, [currentAccount, targetAccount]));

      const saveStateSpy = vi.spyOn(stateStore, "saveState").mockRejectedValueOnce(new Error("disk full"));

      await expect(removeAccount("target@example.com")).rejects.toThrow("disk full");

      await expect(readFile(targetAccount.authPath, "utf8")).resolves.toBe(targetRaw);
      await expect(stateStore.loadState()).resolves.toMatchObject({
        currentProfileId: currentAccount.profileId,
        accounts: {
          [targetAccount.profileId]: expect.objectContaining({
            email: targetAccount.email,
          }),
        },
      });

      saveStateSpy.mockRestore();
    });
  });

  test("restores both auth files when state persistence fails for the sole active removal", async () => {
    await withTempHome(async () => {
      const currentAuthPath = getCodexAuthPath();
      const account = createAccountRecordFixture("profile-1", "foo@example.com", "acct-1");
      const storedRaw = createAuthRaw(account.accountId, "token-stored");
      const activeRaw = createAuthRaw(account.accountId, "token-active");

      await writeFileCredentialStoreConfig();
      await writeAuthFixture(currentAuthPath, account.accountId, "token-active");
      await writeAuthFixture(account.authPath, account.accountId, "token-stored");
      await stateStore.saveState(createStateFixture(account.profileId, [account]));

      const saveStateSpy = vi.spyOn(stateStore, "saveState").mockRejectedValueOnce(new Error("disk full"));

      await expect(removeAccount("foo@example.com")).rejects.toThrow("disk full");

      await expect(readFile(account.authPath, "utf8")).resolves.toBe(storedRaw);
      await expect(readFile(currentAuthPath, "utf8")).resolves.toBe(activeRaw);
      await expect(stateStore.loadState()).resolves.toMatchObject({
        currentProfileId: account.profileId,
      });

      saveStateSpy.mockRestore();
    });
  });

  test("fails for keyring-backed active auth during sole active removal", async () => {
    await withTempHome(async () => {
      const currentConfigPath = getCodexConfigPath();
      const account = createAccountRecordFixture("profile-1", "foo@example.com", "acct-1");

      await mkdir(dirname(currentConfigPath), { recursive: true });
      await writeFile(currentConfigPath, 'cli_auth_credentials_store = "keyring"\n', "utf8");
      await writeAuthFixture(account.authPath, account.accountId, "token-stored");
      await stateStore.saveState(createStateFixture(account.profileId, [account]));

      await expect(removeAccount("foo@example.com")).rejects.toBeInstanceOf(UnsupportedCredentialStoreError);
      await expect(readFile(account.authPath, "utf8")).resolves.toContain("token-stored");
    });
  });
});
