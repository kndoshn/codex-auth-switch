import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { withTempHome } from "./helpers/home.js";
import { createAccountRecord } from "../src/lib/account-record.js";
import { getCodexAuthPath } from "../src/lib/paths.js";
import { activateAccount } from "../src/services/account-service.js";
import * as store from "../src/state/store.js";

vi.mock("../src/lib/process.js", () => ({ assertNoRunningCodexProcess: vi.fn(async () => undefined) }));
afterEach(() => vi.restoreAllMocks());
const auth = (id: string, token: string) => JSON.stringify({ tokens: { account_id: id, access_token: token, refresh_token: `refresh-${token}` } });

async function seed() {
  const a = createAccountRecord("a@example.com", "id-a");
  const b = createAccountRecord("b@example.com", "id-b");
  const c = createAccountRecord("c@example.com", "id-c");
  await mkdir(dirname(a.authPath), { recursive: true });
  for (const account of [a, b, c]) await writeFile(account.authPath, auth(account.accountId, `old-${account.accountId}`));
  const state = { currentProfileId: a.profileId, accounts: { [a.profileId]: a, [b.profileId]: b, [c.profileId]: c } };
  await store.saveState(state);
  await mkdir(dirname(getCodexAuthPath()), { recursive: true });
  await writeFile(getCodexAuthPath(), auth(b.accountId, "fresh-b"));
  return { a, b, c, state };
}

test.each(["b", "c"] as const)("switches to %s after an external login with omitted storage config", async (target) => {
  await withTempHome(async () => {
    const { a, b, c } = await seed();
    const account = target === "b" ? b : c;
    await activateAccount(account.email);
    expect((await store.loadState()).currentProfileId).toBe(account.profileId);
    await expect(readFile(a.authPath, "utf8")).resolves.toBe(auth(a.accountId, `old-${a.accountId}`));
    await expect(readFile(b.authPath, "utf8")).resolves.toBe(auth(b.accountId, "fresh-b"));
    await expect(readFile(getCodexAuthPath(), "utf8")).resolves.toBe(auth(account.accountId, target === "b" ? "fresh-b" : `old-${c.accountId}`));
  });
});

test("restores live identity after state-save failure without corrupting either snapshot", async () => {
  await withTempHome(async () => {
    const { a, b, c, state } = await seed();
    vi.spyOn(store, "saveState").mockRejectedValueOnce(new Error("disk full"));
    await expect(activateAccount(c.email)).rejects.toThrow("disk full");
    await expect(store.loadState()).resolves.toEqual(state);
    await expect(readFile(getCodexAuthPath(), "utf8")).resolves.toBe(auth(b.accountId, "fresh-b"));
    await expect(readFile(a.authPath, "utf8")).resolves.toBe(auth(a.accountId, `old-${a.accountId}`));
    await expect(readFile(b.authPath, "utf8")).resolves.toBe(auth(b.accountId, "fresh-b"));
  });
});

test.each(["unknown", "ambiguous", "invalid-target"])("refuses %s without copying live credentials to a saved snapshot", async (scenario) => {
  await withTempHome(async () => {
    const { a, b, c, state } = await seed();
    if (scenario === "unknown") await writeFile(getCodexAuthPath(), auth("unknown-id", "unmanaged"));
    if (scenario === "ambiguous") {
      c.accountId = b.accountId;
      await store.saveState(state);
    }
    const paths = [getCodexAuthPath(), a.authPath, b.authPath, c.authPath];
    const before = await Promise.all(paths.map((path) => readFile(path, "utf8")));
    await expect(activateAccount(scenario === "invalid-target" ? "missing@example.com" : b.email)).rejects.toThrow();
    expect(await Promise.all(paths.map((path) => readFile(path, "utf8")))).toEqual(before);
    await expect(store.loadState()).resolves.toEqual(state);
  });
});
