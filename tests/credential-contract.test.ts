import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { withFileCodexHome } from "./helpers/home.js";
import { addAccount, activateAccount, removeAccount } from "../src/services/account-service.js";
import { persistRegisteredAccount } from "../src/services/account-add.js";
import { fetchUsageForAll, fetchUsage } from "../src/services/usage-service.js";
import { createAccountRecord } from "../src/lib/account-record.js";
import { getAccountsDir, getCodexAuthPath, getCodexConfigPath } from "../src/lib/paths.js";
import { saveState, loadState } from "../src/state/store.js";
import * as auth from "../src/lib/auth.js";
import { CodexProcessRunningError, UnsupportedCredentialStoreError } from "../src/lib/errors.js";

const { login, inspect } = vi.hoisted(() => ({ login: vi.fn(), inspect: vi.fn() }));
vi.mock("execa", () => ({ execa: login }));
vi.mock("../src/lib/process.js", () => ({ assertNoRunningCodexProcess: inspect }));
const raw = JSON.stringify({ tokens: { account_id: "synthetic-account", access_token: "synthetic-token" } });
const snapshot = { raw, accountId: "synthetic-account", accessToken: "synthetic-token", refreshToken: null, lastRefresh: null };

beforeEach(() => {
  inspect.mockReset().mockResolvedValue(undefined);
  login.mockReset().mockImplementation(async (_command, _args, options) => {
    await expect(readFile(join(options.env.CODEX_HOME, "config.toml"), "utf8"))
      .resolves.toBe('cli_auth_credentials_store = "file"\n');
    await writeFile(join(options.env.CODEX_HOME, "auth.json"), raw);
    return { exitCode: 0 };
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test.each(['cli_auth_credentials_store = "keyring"', 'cli_auth_credentials_store = "auto"'])
("rejects first add, use and active removal without file mode: %s", async (config) => {
  await withFileCodexHome(async () => {
    await writeFile(getCodexConfigPath(), config);
    await writeFile(getCodexAuthPath(), raw);
    await expect(addAccount("new@example.com")).rejects.toBeInstanceOf(UnsupportedCredentialStoreError);
    expect(login).not.toHaveBeenCalled();
    await expect(persistRegisteredAccount("new@example.com", snapshot)).rejects.toBeInstanceOf(UnsupportedCredentialStoreError);
    await expect(readFile(getCodexAuthPath(), "utf8")).resolves.toBe(raw);
    await expect(loadState()).resolves.toEqual({ currentProfileId: null, accounts: {} });
    await expect(readdir(getAccountsDir())).rejects.toMatchObject({ code: "ENOENT" });
    const current = createAccountRecord("current@example.com", snapshot.accountId);
    await auth.writeAuthFile(current.authPath, raw);
    const state = { currentProfileId: current.profileId, accounts: { [current.profileId]: current } };
    await saveState(state);
    await expect(activateAccount(current.email)).rejects.toBeInstanceOf(UnsupportedCredentialStoreError);
    await expect(removeAccount(current.email)).rejects.toBeInstanceOf(UnsupportedCredentialStoreError);
    await expect(loadState()).resolves.toEqual(state);
    await expect(readFile(current.authPath, "utf8")).resolves.toBe(raw);
    await expect(readFile(getCodexAuthPath(), "utf8")).resolves.toBe(raw);
  });
});

test("checks for running Codex before opening login", async () => {
  await withFileCodexHome(async () => {
    inspect.mockRejectedValueOnce(new CodexProcessRunningError("running"));
    await expect(addAccount("new@example.com")).rejects.toBeInstanceOf(CodexProcessRunningError);
    expect(login).not.toHaveBeenCalled();
    await expect(readdir(getAccountsDir())).rejects.toMatchObject({ code: "ENOENT" });
  });
});

test.each(["config", "process"])("rechecks %s after login and leaves no snapshots", async (change) => {
  await withFileCodexHome(async () => {
    await writeFile(getCodexAuthPath(), "previous-auth");
    login.mockImplementationOnce(async (_command, _args, options) => {
      await writeFile(join(options.env.CODEX_HOME, "auth.json"), raw);
      if (change === "config") await writeFile(getCodexConfigPath(), 'cli_auth_credentials_store = "keyring"');
      else inspect.mockRejectedValueOnce(new CodexProcessRunningError("started during login"));
      return { exitCode: 0 };
    });
    await expect(addAccount("new@example.com")).rejects.toThrow();
    await expect(readFile(getCodexAuthPath(), "utf8")).resolves.toBe("previous-auth");
    await expect(loadState()).resolves.toEqual({ currentProfileId: null, accounts: {} });
    await expect(readdir(getAccountsDir()).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error))).resolves.toEqual([]);
  });
});

test("registers an inactive account without inspecting or overwriting active auth", async () => {
  await withFileCodexHome(async () => {
    const current = createAccountRecord("current@example.com", "current-id");
    await saveState({ currentProfileId: current.profileId, accounts: { [current.profileId]: current } });
    await writeFile(getCodexConfigPath(), 'cli_auth_credentials_store = "keyring"');
    await writeFile(getCodexAuthPath(), "previous-auth");
    await addAccount("new@example.com");
    expect(inspect).not.toHaveBeenCalled();
    await expect(readFile(getCodexAuthPath(), "utf8")).resolves.toBe("previous-auth");
    expect((await loadState()).currentProfileId).toBe(current.profileId);
  });
});

test.each([false, true])("rolls back an auth write that fails after replacing the file (previous=%s)", async (previous) => {
  await withFileCodexHome(async () => {
    if (previous) await writeFile(getCodexAuthPath(), "previous-auth");
    const write = auth.writeAuthFile;
    let injected = false;
    vi.spyOn(auth, "writeAuthFile").mockImplementation(async (path, value) => {
      await write(path, value);
      if (path === getCodexAuthPath() && !injected) {
        injected = true;
        throw new Error("failure after rename");
      }
    });
    await expect(persistRegisteredAccount("new@example.com", snapshot)).rejects.toThrow("failure after rename");
    await expect(readdir(getAccountsDir())).resolves.toEqual([]);
    if (previous) await expect(readFile(getCodexAuthPath(), "utf8")).resolves.toBe("previous-auth");
    else await expect(readFile(getCodexAuthPath())).rejects.toMatchObject({ code: "ENOENT" });
    expect((await loadState()).currentProfileId).toBeNull();
  });
});

test.each(['cli_auth_credentials_store = "keyring"', 'cli_auth_credentials_store = "auto"', 'broken = "secret" invalid'])
("usage --all contains active auth errors and still queries inactive accounts: %s", async (config) => {
  await withFileCodexHome(async () => {
    const current = createAccountRecord("a@example.com", snapshot.accountId);
    const other = createAccountRecord("b@example.com", snapshot.accountId);
    await auth.writeAuthFile(current.authPath, raw);
    await auth.writeAuthFile(other.authPath, raw);
    await saveState({ currentProfileId: current.profileId, accounts: { [current.profileId]: current, [other.profileId]: other } });
    await writeFile(getCodexConfigPath(), config);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ rate_limit: {} })));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchUsageForAll([other, current])).resolves.toMatchObject([
      { email: current.email, ok: false, code: "auth_invalid" },
      { email: other.email, ok: true },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

test("usage falls back only for absent live auth, not corrupt or unreadable auth", async () => {
  await withFileCodexHome(async () => {
    const current = createAccountRecord("current@example.com", snapshot.accountId);
    await auth.writeAuthFile(current.authPath, raw);
    await saveState({ currentProfileId: current.profileId, accounts: { [current.profileId]: current } });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ rate_limit: {} })));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchUsage(current)).resolves.toMatchObject({ ok: true });
    await writeFile(getCodexAuthPath(), "invalid-json");
    await expect(fetchUsage(current)).resolves.toMatchObject({ ok: false, code: "auth_invalid" });
    await rm(getCodexAuthPath());
    await mkdir(getCodexAuthPath());
    await expect(fetchUsage(current)).resolves.toMatchObject({ ok: false, code: "auth_invalid" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
