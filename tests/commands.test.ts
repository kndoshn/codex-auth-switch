import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { AccountRecord } from "../src/types.js";

const mocks = vi.hoisted(() => ({
  addAccount: vi.fn(),
  activateAccount: vi.fn(),
  removeAccount: vi.fn(),
  listAccounts: vi.fn(),
  getAccountByEmail: vi.fn(),
  getCurrentAccount: vi.fn(),
  fetchUsage: vi.fn(),
  fetchUsageForAll: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
  confirm: mocks.confirm,
  select: mocks.select,
}));

vi.mock("../src/services/account-service.js", () => ({
  addAccount: mocks.addAccount,
  activateAccount: mocks.activateAccount,
  removeAccount: mocks.removeAccount,
  listAccounts: mocks.listAccounts,
  getAccountByEmail: mocks.getAccountByEmail,
  getCurrentAccount: mocks.getCurrentAccount,
}));

vi.mock("../src/services/usage-service.js", () => ({
  fetchUsage: mocks.fetchUsage,
  fetchUsageForAll: mocks.fetchUsageForAll,
}));

import { runCli } from "../src/cli.js";

function createAccount(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    profileId: "profile-1",
    email: "foo@example.com",
    accountId: "acct-1",
    authPath: "/tmp/foo.json",
    createdAt: "2026-04-04T00:00:00.000Z",
    lastUsedAt: "2026-04-04T00:00:00.000Z",
    ...overrides,
  };
}

function createBuffer(isTTY = false): {
  isTTY: boolean;
  value: string;
  write: (chunk: string) => boolean;
} {
  return {
    isTTY,
    value: "",
    write(chunk: string): boolean {
      this.value += chunk;
      return true;
    },
  };
}

function captureProcessIo(): {
  stdout: ReturnType<typeof createBuffer>;
  stderr: ReturnType<typeof createBuffer>;
} {
  const stdout = createBuffer(false);
  const stderr = createBuffer(false);
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdout.write(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr.write(String(chunk));
    return true;
  });
  return { stdout, stderr };
}

describe("command execution", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  test("ls prints formatted accounts", async () => {
    mocks.listAccounts.mockResolvedValue({
      accounts: [createAccount({ accountId: "123456789" })],
      currentProfileId: "profile-1",
    });

    const { stdout } = captureProcessIo();

    await runCli(["ls"]);
    expect(stdout.value).toContain("Saved accounts (1)");
    expect(stdout.value).toContain("[Current]");
    expect(stdout.value).toContain("foo@example.com");
  });

  test("add registers an account and prints the normalized email", async () => {
    mocks.addAccount.mockImplementation(async (_email, options) => {
      options?.onStageChange?.("validating_email");
      options?.onStageChange?.("preparing_login");
      options?.onStageChange?.("awaiting_login");
      options?.onStageChange?.("saving_account");
      return createAccount();
    });

    const { stdout } = captureProcessIo();

    await runCli(["add", "Foo@Example.com"]);
    expect(mocks.addAccount).toHaveBeenCalledWith("Foo@Example.com", expect.any(Object));
    expect(stdout.value).toContain("Added account");
    expect(stdout.value).toContain("Email      : foo@example.com");
    expect(stdout.value).toContain("Account ID : acct-1");
  });

  test("add accepts a quoted email argument", async () => {
    mocks.addAccount.mockResolvedValue(createAccount({ email: "admin@northview.jp" }));

    const { stdout } = captureProcessIo();

    await runCli(["add", '"admin@northview.jp"']);
    expect(mocks.addAccount).toHaveBeenCalledWith('"admin@northview.jp"', expect.any(Object));
    expect(stdout.value).toContain("Email      : admin@northview.jp");
  });

  test("use prompts when email is omitted", async () => {
    mocks.listAccounts.mockResolvedValue({
      accounts: [createAccount()],
      currentProfileId: null,
    });
    mocks.select.mockResolvedValue("foo@example.com");
    mocks.activateAccount.mockImplementation(async (_email, options) => {
      options?.onStageChange?.("checking_processes");
      options?.onStageChange?.("loading_account");
      options?.onStageChange?.("writing_auth");
      options?.onStageChange?.("saving_state");
      return createAccount();
    });

    const { stdout } = captureProcessIo();

    await runCli(["use"]);
    expect(mocks.select).toHaveBeenCalled();
    expect(mocks.activateAccount).toHaveBeenCalledWith("foo@example.com", expect.any(Object));
    expect(stdout.value).toContain("Active account");
    expect(stdout.value).toContain("Email      : foo@example.com");
    expect(stdout.value).toContain("Account ID : acct-1");
  });

  test("remove prompts when email is omitted", async () => {
    mocks.listAccounts.mockResolvedValue({
      accounts: [createAccount()],
      currentProfileId: null,
    });
    mocks.select.mockResolvedValue("foo@example.com");
    mocks.confirm.mockResolvedValue(true);
    mocks.removeAccount.mockImplementation(async (_email, options) => {
      options?.onStageChange?.("loading_account");
      options?.onStageChange?.("removing_auth");
      options?.onStageChange?.("saving_state");
      return createAccount();
    });

    const { stdout } = captureProcessIo();

    await runCli(["remove"]);
    expect(mocks.select).toHaveBeenCalled();
    expect(mocks.confirm).toHaveBeenCalled();
    expect(mocks.removeAccount).toHaveBeenCalledWith("foo@example.com", expect.any(Object));
    expect(stdout.value).toContain("Removed account");
    expect(stdout.value).toContain("Email      : foo@example.com");
  });

  test("remove skips confirmation with --yes", async () => {
    mocks.getAccountByEmail.mockResolvedValue(createAccount());
    mocks.removeAccount.mockResolvedValue(createAccount());

    const { stdout } = captureProcessIo();

    await runCli(["remove", " Foo@Example.com ", "--yes"]);
    expect(mocks.getAccountByEmail).toHaveBeenCalledWith("foo@example.com");
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.removeAccount).toHaveBeenCalledWith("foo@example.com", expect.any(Object));
    expect(stdout.value).toContain("Removed account");
  });

  test("remove exits cleanly when confirmation is declined", async () => {
    mocks.getAccountByEmail.mockResolvedValue(createAccount());
    mocks.confirm.mockResolvedValue(false);

    const { stdout } = captureProcessIo();

    await runCli(["remove", "foo@example.com"]);
    expect(mocks.removeAccount).not.toHaveBeenCalled();
    expect(stdout.value).toContain("Canceled.");
  });

  test("use reports when no saved accounts are available for interactive selection", async () => {
    mocks.listAccounts.mockResolvedValue({
      accounts: [],
      currentProfileId: null,
    });

    const { stderr } = captureProcessIo();

    await runCli(["use"]);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(stderr.value).toContain("No saved accounts yet.");
  });

  test("remove reports when the interactive selection becomes stale", async () => {
    mocks.listAccounts.mockResolvedValue({
      accounts: [createAccount()],
      currentProfileId: null,
    });
    mocks.select.mockResolvedValue("missing@example.com");

    const { stderr } = captureProcessIo();

    await runCli(["remove"]);
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.removeAccount).not.toHaveBeenCalled();
    expect(stderr.value).toContain("No saved accounts yet.");
  });

  test("usage rejects email together with --all", async () => {
    const { stderr } = captureProcessIo();

    await runCli(["usage", "foo@example.com", "--all"]);
    expect(process.exitCode).toBe(1);
    expect(stderr.value).toContain("Cannot use an email argument together with --all.");
  });

  test("usage prints JSON and returns exit code 3 when all results fail", async () => {
    mocks.listAccounts.mockResolvedValue({
      accounts: [
        {
          profileId: "profile-1",
          email: "foo@example.com",
          accountId: "acct-1",
          authPath: "/tmp/foo.json",
          createdAt: "2026-04-04T00:00:00.000Z",
          lastUsedAt: "2026-04-04T00:00:00.000Z",
        },
      ],
      currentProfileId: null,
    });
    mocks.fetchUsageForAll.mockResolvedValue([
      {
        email: "foo@example.com",
        ok: false,
        code: "unauthorized",
        error: "denied",
      },
    ]);

    const { stdout } = captureProcessIo();

    await runCli(["usage", "--all", "--json"]);
    expect(process.exitCode).toBe(3);
    expect(stdout.value).toContain("\"email\": \"foo@example.com\"");
    expect(stdout.value).toContain("\"code\": \"unauthorized\"");
  });

  test("usage fetches the current account when no email is provided", async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      profileId: "profile-1",
      email: "foo@example.com",
      accountId: "acct-1",
      authPath: "/tmp/foo.json",
      createdAt: "2026-04-04T00:00:00.000Z",
      lastUsedAt: "2026-04-04T00:00:00.000Z",
    });
    mocks.fetchUsage.mockResolvedValue({
      email: "foo@example.com",
      ok: true,
      snapshot: {
        email: "foo@example.com",
        observedEmail: null,
        planType: "pro",
        primaryWindow: null,
        secondaryWindow: null,
        secondaryWindowIssue: null,
        fetchedAt: "2026-04-04T00:00:00.000Z",
      },
    });

    const { stdout } = captureProcessIo();

    await runCli(["usage"]);
    expect(mocks.getCurrentAccount).toHaveBeenCalledTimes(1);
    expect(stdout.value).toContain("Usage — foo@example.com");
    expect(stdout.value).toContain("Plan");
    expect(stdout.value).toContain(": Pro");
    expect(stdout.value).not.toContain("Status");
    expect(stdout.value).toContain("5h limit");
    expect(stdout.value).toContain("Weekly limit");
    expect(stdout.value).toContain("Tip: Run `usage --all` to see all accounts.");
  });

  test("usage fetches a specific normalized email when provided", async () => {
    mocks.getAccountByEmail.mockResolvedValue({
      profileId: "profile-1",
      email: "foo@example.com",
      accountId: "acct-1",
      authPath: "/tmp/foo.json",
      createdAt: "2026-04-04T00:00:00.000Z",
      lastUsedAt: "2026-04-04T00:00:00.000Z",
    });
    mocks.fetchUsage.mockResolvedValue({
      email: "foo@example.com",
      ok: true,
      snapshot: {
        email: "foo@example.com",
        observedEmail: null,
        planType: null,
        primaryWindow: null,
        secondaryWindow: null,
        secondaryWindowIssue: null,
        fetchedAt: "2026-04-04T00:00:00.000Z",
      },
    });

    const { stdout } = captureProcessIo();

    await runCli(["usage", " Foo@Example.com "]);
    expect(mocks.getAccountByEmail).toHaveBeenCalledWith("foo@example.com");
    expect(stdout.value).toContain("foo@example.com");
    expect(stdout.value).not.toContain("Tip:");
  });

  test("usage --all fails when no accounts are registered", async () => {
    mocks.listAccounts.mockResolvedValue({
      accounts: [],
      currentProfileId: null,
    });
    const { stderr } = captureProcessIo();

    await runCli(["usage", "--all"]);

    expect(process.exitCode).toBe(1);
    expect(stderr.value).toContain("No saved accounts yet.");
  });

  test("usage --all reports a successful human-readable result", async () => {
    mocks.listAccounts.mockResolvedValue({
      accounts: [
        {
          profileId: "profile-1",
          email: "foo@example.com",
          accountId: "acct-1",
          authPath: "/tmp/foo.json",
          createdAt: "2026-04-04T00:00:00.000Z",
          lastUsedAt: "2026-04-04T00:00:00.000Z",
        },
        {
          profileId: "profile-2",
          email: "bar@example.com",
          accountId: "acct-2",
          authPath: "/tmp/bar.json",
          createdAt: "2026-04-04T00:00:00.000Z",
          lastUsedAt: "2026-04-04T00:00:00.000Z",
        },
      ],
      currentProfileId: "profile-1",
    });
    mocks.fetchUsageForAll.mockImplementation(async (_accounts, options) => {
      options?.onProgress?.({ total: 2, completed: 1, failed: 1 });
      return [
        {
          email: "foo@example.com",
          ok: true,
          snapshot: {
            email: "foo@example.com",
            observedEmail: "real@example.com",
            planType: "pro",
            primaryWindow: null,
            secondaryWindow: null,
            secondaryWindowIssue: null,
            fetchedAt: "2026-04-04T00:00:00.000Z",
          },
        },
        {
          email: "bar@example.com",
          ok: false,
          code: "rate_limited",
          error: "too many requests",
        },
      ];
    });

    const { stdout } = captureProcessIo();

    await runCli(["usage", "--all"]);

    expect(stdout.value).toContain("Usage summary (2 accounts)");
    expect(stdout.value).toContain("▶ foo@example.com (Current)");
    expect(stdout.value).not.toContain("▶ bar@example.com");
    expect(stdout.value).toContain("bar@example.com");
    expect(stdout.value).toContain("rate_limited");
    expect(stdout.value).toContain("Observed email : real@example.com");
    expect(stdout.value).not.toContain("Tip:");
  });
});
