import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createAccountRecord } from "../src/lib/account-record.js";
import { formatAccountList } from "../src/lib/format.js";
import { getCodexAuthPath, getCodexConfigPath, getStatePath } from "../src/lib/paths.js";
import { listAccounts } from "../src/services/account-service.js";
import { observeAuthFile } from "../src/services/account-observation.js";
import { saveState } from "../src/state/store.js";
import { withFileCodexHome } from "./helpers/home.js";

const authRaw = (accountId: string) => JSON.stringify({ tokens: { account_id: accountId, access_token: "synthetic-secret" } });
async function seedAccounts() {
  const selected = createAccountRecord("selected@example.com", "selected-id");
  const observed = createAccountRecord("observed@example.com", "observed-id");
  await saveState({ currentProfileId: selected.profileId, accounts: { [selected.profileId]: selected, [observed.profileId]: observed } });
  await mkdir(join(getStatePath(), "..", "accounts"), { recursive: true });
  await writeFile(selected.authPath, authRaw(selected.accountId));
  await writeFile(observed.authPath, authRaw(observed.accountId));
  return { selected, observed };
}

test.each(["file", "auto", "keyring", null])("reports selection/file mismatch without modifying credentials (%s)", async (mode) => {
  await withFileCodexHome(async () => {
    const { selected, observed } = await seedAccounts();
    await writeFile(getCodexConfigPath(), mode ? `cli_auth_credentials_store = "${mode}"\n` : "");
    await writeFile(getCodexAuthPath(), authRaw(observed.accountId));
    const paths = [getCodexAuthPath(), getCodexConfigPath(), getStatePath(), selected.authPath, observed.authPath];
    await chmod(getCodexAuthPath(), 0o640);
    const before = await Promise.all(paths.map(async (path) => ({ raw: await readFile(path, "utf8"), mode: (await stat(path)).mode })));
    const result = await listAccounts();
    expect(result.currentProfileId).toBe(selected.profileId);
    expect(result.authFile).toEqual({ status: "available", accountId: observed.accountId, configuredMode: mode });
    const output = formatAccountList(result.accounts, result.currentProfileId, result.authFile);
    expect(output).toMatch(/\[Selected\]\s+selected@example.com/);
    expect(output).toMatch(/\[Auth file\]\s+observed@example.com/);
    expect(output).toContain("Mismatch:");
    expect(output).not.toContain("[Current]");
    expect(output).not.toContain("synthetic-secret");
    if (mode !== "file" && mode !== null) expect(output).toContain("The file may not be the credentials Codex uses.");
    const after = await Promise.all(paths.map(async (path) => ({ raw: await readFile(path, "utf8"), mode: (await stat(path)).mode })));
    expect(after).toEqual(before);
  });
});

test.each(["missing", "invalid", "unreadable"] as const)("keeps listing accounts when auth is %s", async (status) => {
  await withFileCodexHome(async () => {
    await seedAccounts();
    if (status === "invalid") await writeFile(getCodexAuthPath(), '{"access_token":"synthetic-secret", invalid');
    if (status === "unreadable") await mkdir(getCodexAuthPath());
    const result = await listAccounts();
    expect(result.authFile.status).toBe(status);
    const output = formatAccountList(result.accounts, result.currentProfileId, result.authFile);
    expect(output).toContain(`Auth file identity is ${status}`);
    expect(output).toContain("selected@example.com");
    expect(output).not.toContain("synthetic-secret");
    expect(output).not.toMatch(/\[Auth file\]\s+\w+@/);
  });
});

test("marks matching selection and auth file together", async () => {
  await withFileCodexHome(async () => {
    const { selected } = await seedAccounts();
    await writeFile(getCodexAuthPath(), authRaw(selected.accountId));
    const result = await listAccounts();
    const output = formatAccountList(result.accounts, result.currentProfileId, result.authFile);
    expect(output).toContain("[Selected] [Auth file]");
    expect(output).not.toContain("Mismatch:");
  });
});

test("reports an unmanaged auth file account instead of choosing a saved label", async () => {
  await withFileCodexHome(async () => {
    await seedAccounts();
    await writeFile(getCodexAuthPath(), authRaw("unmanaged-id"));
    const result = await listAccounts();
    const output = formatAccountList(result.accounts, result.currentProfileId, result.authFile);
    expect(output).toContain("Auth file account ID unmanaged-id is not saved");
    expect(output).not.toMatch(/\[Auth file\]\s+\w+@/);
  });
});

test("does not pick one label when multiple labels share the auth file account ID", async () => {
  await withFileCodexHome(async () => {
    const { selected, observed } = await seedAccounts();
    observed.accountId = selected.accountId;
    await saveState({ currentProfileId: selected.profileId, accounts: { [selected.profileId]: selected, [observed.profileId]: observed } });
    await writeFile(getCodexAuthPath(), authRaw(selected.accountId));
    const result = await listAccounts();
    expect(formatAccountList(result.accounts, result.currentProfileId, result.authFile)).toContain("Multiple saved labels");
  });
});

test("sanitizes config errors while still observing the auth file", async () => {
  await withFileCodexHome(async () => {
    await writeFile(getCodexConfigPath(), 'key = "synthetic-secret" invalid');
    await writeFile(getCodexAuthPath(), authRaw("observed-id"));
    await expect(observeAuthFile()).resolves.toEqual({ status: "available", accountId: "observed-id", configuredMode: "unknown" });
  });
});

test("observes only the explicitly selected CODEX_HOME", async () => {
  await withFileCodexHome(async (homeDir) => {
    await writeFile(getCodexAuthPath(), authRaw("default-id"));
    const custom = join(homeDir, "custom-codex");
    await mkdir(custom);
    await writeFile(join(custom, "auth.json"), authRaw("custom-id"));
    process.env.CODEX_HOME = custom;
    await expect(observeAuthFile()).resolves.toMatchObject({ accountId: "custom-id" });
  });
});
