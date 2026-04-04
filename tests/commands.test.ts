import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addAccount: vi.fn(),
  activateAccount: vi.fn(),
  listAccounts: vi.fn(),
  getAccountByEmail: vi.fn(),
  getCurrentAccount: vi.fn(),
  fetchUsage: vi.fn(),
  fetchUsageForAll: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
  select: mocks.select,
}));

vi.mock("../src/services/account-service.js", () => ({
  addAccount: mocks.addAccount,
  activateAccount: mocks.activateAccount,
  listAccounts: mocks.listAccounts,
  getAccountByEmail: mocks.getAccountByEmail,
  getCurrentAccount: mocks.getCurrentAccount,
}));

vi.mock("../src/services/usage-service.js", () => ({
  fetchUsage: mocks.fetchUsage,
  fetchUsageForAll: mocks.fetchUsageForAll,
}));

import { runCli } from "../src/cli.js";

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
      accounts: [
        {
          profileId: "profile-1",
          email: "foo@example.com",
          accountId: "123456789",
          authPath: "/tmp/foo.json",
          createdAt: "2026-04-04T00:00:00.000Z",
          lastUsedAt: "2026-04-04T00:00:00.000Z",
        },
      ],
      currentProfileId: "profile-1",
    });

    const { stdout } = captureProcessIo();

    await runCli(["ls"]);
    expect(stdout.value).toContain("Saved accounts (1)");
    expect(stdout.value).toContain("yes     foo@example.com");
  });

  test("add registers an account and prints the normalized email", async () => {
    mocks.addAccount.mockImplementation(async (_email, options) => {
      options?.onStageChange?.("validating_email");
      options?.onStageChange?.("preparing_login");
      options?.onStageChange?.("awaiting_login");
      options?.onStageChange?.("saving_account");
      return {
        profileId: "profile-1",
        email: "foo@example.com",
        accountId: "acct-1",
        authPath: "/tmp/foo.json",
        createdAt: "2026-04-04T00:00:00.000Z",
        lastUsedAt: "2026-04-04T00:00:00.000Z",
      };
    });

    const { stdout } = captureProcessIo();

    await runCli(["add", "Foo@Example.com"]);
    expect(mocks.addAccount).toHaveBeenCalledWith("Foo@Example.com", expect.any(Object));
    expect(stdout.value).toContain("Added account");
    expect(stdout.value).toContain("Label      : foo@example.com");
    expect(stdout.value).toContain("Account ID : acct-1");
  });

  test("add accepts a quoted email argument", async () => {
    mocks.addAccount.mockResolvedValue({
      profileId: "profile-1",
      email: "admin@northview.jp",
      accountId: "acct-1",
      authPath: "/tmp/foo.json",
      createdAt: "2026-04-04T00:00:00.000Z",
      lastUsedAt: "2026-04-04T00:00:00.000Z",
    });

    const { stdout } = captureProcessIo();

    await runCli(["add", '"admin@northview.jp"']);
    expect(mocks.addAccount).toHaveBeenCalledWith('"admin@northview.jp"', expect.any(Object));
    expect(stdout.value).toContain("Label      : admin@northview.jp");
  });

  test("use prompts when email is omitted", async () => {
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
    mocks.select.mockResolvedValue("foo@example.com");
    mocks.activateAccount.mockImplementation(async (_email, options) => {
      options?.onStageChange?.("checking_processes");
      options?.onStageChange?.("loading_account");
      options?.onStageChange?.("writing_auth");
      options?.onStageChange?.("saving_state");
      return {
        profileId: "profile-1",
        email: "foo@example.com",
        accountId: "acct-1",
        authPath: "/tmp/foo.json",
        createdAt: "2026-04-04T00:00:00.000Z",
        lastUsedAt: "2026-04-04T00:00:00.000Z",
      };
    });

    const { stdout } = captureProcessIo();

    await runCli(["use"]);
    expect(mocks.select).toHaveBeenCalled();
    expect(mocks.activateAccount).toHaveBeenCalledWith("foo@example.com", expect.any(Object));
    expect(stdout.value).toContain("Active account");
    expect(stdout.value).toContain("Label      : foo@example.com");
    expect(stdout.value).toContain("Account ID : acct-1");
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
        fetchedAt: "2026-04-04T00:00:00.000Z",
      },
    });

    const { stdout } = captureProcessIo();

    await runCli(["usage"]);
    expect(mocks.getCurrentAccount).toHaveBeenCalledTimes(1);
    expect(stdout.value).toContain("foo@example.com");
    expect(stdout.value).toContain("Plan");
    expect(stdout.value).toContain(": pro");
    expect(stdout.value).toContain("Status");
    expect(stdout.value).toContain(": ok");
    expect(stdout.value).toContain("5h limit");
    expect(stdout.value).toContain("Weekly limit");
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
        fetchedAt: "2026-04-04T00:00:00.000Z",
      },
    });

    const { stdout } = captureProcessIo();

    await runCli(["usage", " Foo@Example.com "]);
    expect(mocks.getAccountByEmail).toHaveBeenCalledWith("foo@example.com");
    expect(stdout.value).toContain("foo@example.com");
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
      currentProfileId: null,
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
    expect(stdout.value).toContain("foo@example.com");
    expect(stdout.value).toContain("bar@example.com");
    expect(stdout.value).toContain("rate_limited");
    expect(stdout.value).toContain("Observed email : real@example.com");
  });
});
