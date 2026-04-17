import { describe, expect, test } from "vitest";

import { formatAccountActionResult, formatAccountList, formatUsageResults } from "../src/lib/format.js";

function formatExpectedReset(value: string, anchor: string): string {
  const resetAt = new Date(value);
  const anchorDate = new Date(anchor);
  const time = `${String(resetAt.getHours()).padStart(2, "0")}:${String(resetAt.getMinutes()).padStart(2, "0")}`;

  if (
    resetAt.getFullYear() === anchorDate.getFullYear()
    && resetAt.getMonth() === anchorDate.getMonth()
    && resetAt.getDate() === anchorDate.getDate()
  ) {
    return time;
  }

  const month = resetAt.toLocaleString("en-US", { month: "short" });
  return `${time} on ${resetAt.getDate()} ${month}`;
}

describe("formatAccountList", () => {
  test("returns a fallback message when there are no accounts", () => {
    expect(formatAccountList([], null)).toContain("No saved accounts yet.");
    expect(formatAccountList([], null)).toContain("./codex-auth-switch add <email>");
  });

  test("shows the current profile in the Active column", () => {
    const output = formatAccountList(
      [
        {
          profileId: "profile-1",
          email: "foo@example.com",
          accountId: "123456789",
          authPath: "/tmp/foo.json",
          createdAt: "2026-04-04T00:00:00.000Z",
          lastUsedAt: "2026-04-04T00:00:00.000Z",
        },
        {
          profileId: "profile-2",
          email: "bar@example.com",
          accountId: "abcdefghi",
          authPath: "/tmp/bar.json",
          createdAt: "2026-04-04T00:00:00.000Z",
          lastUsedAt: "2026-04-04T00:00:00.000Z",
        },
      ],
      "profile-2",
    );

    expect(output).toContain("Saved accounts (2)");
    expect(output).not.toContain("Active");
    expect(output).toContain("[Current]");
    expect(output).toContain("Email");
    expect(output).toContain("bar@example.com");
    expect(output).toContain("foo@example.com");
    expect(output).toContain("2026-04-04");
    expect(output).toContain("local");
    expect(output).toContain("Tip: Run `use <email>` to switch accounts.");
  });

  test("does not mark any account as current when currentProfileId is null", () => {
    const output = formatAccountList(
      [
        {
          profileId: "profile-1",
          email: "foo@example.com",
          accountId: "123456789",
          authPath: "/tmp/foo.json",
          createdAt: "2026-04-04T00:00:00.000Z",
          lastUsedAt: "2026-04-04T00:00:00.000Z",
        },
      ],
      null,
    );

    expect(output).not.toContain("[Current]");
    expect(output).toContain("foo@example.com");
  });
});

describe("formatUsageResults", () => {
  test("returns a fallback message when there are no results", () => {
    expect(formatUsageResults([])).toBe("No usage data.");
  });

  test("shows email in header for a single result", () => {
    const output = formatUsageResults([
      {
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
      },
    ]);

    expect(output).toContain("Usage — foo@example.com");
    expect(output).not.toContain("Usage summary");
    expect(output).toContain("Plan         : Pro");
  });

  test("renders a usage meter when remaining percentage is available", () => {
    const output = formatUsageResults([
      {
        email: "foo@example.com",
        ok: true,
        snapshot: {
          email: "foo@example.com",
          observedEmail: null,
          planType: "pro",
          primaryWindow: {
            usedPercent: 8,
            resetAt: "2026-04-04T16:43:00.000Z",
            windowMinutes: 300,
          },
          secondaryWindow: null,
          secondaryWindowIssue: null,
          fetchedAt: "2026-04-04T00:00:00.000Z",
        },
      },
    ]);

    expect(output).toContain("5h limit     : [██████████████████░░] 92% left");
  });

  test("explains when the secondary usage window is unavailable", () => {
    const output = formatUsageResults([
      {
        email: "foo@example.com",
        ok: true,
        snapshot: {
          email: "foo@example.com",
          observedEmail: null,
          planType: "pro",
          primaryWindow: null,
          secondaryWindow: null,
          secondaryWindowIssue: "malformed",
          fetchedAt: "2026-04-04T00:00:00.000Z",
        },
      },
    ]);

    expect(output).toContain("Weekly limit : not returned by usage endpoint");
  });

  test("renders n/a when no usage windows are available", () => {
    const output = formatUsageResults([
      {
        email: "foo@example.com",
        ok: true,
        snapshot: {
          email: "foo@example.com",
          observedEmail: null,
          planType: "pro",
          primaryWindow: null,
          secondaryWindow: null,
          secondaryWindowIssue: "unknown" as never,
          fetchedAt: "2026-04-04T00:00:00.000Z",
        },
      },
    ]);

    expect(output).toContain("5h limit     : n/a");
  });

  test("does not duplicate the weekly label when only the primary weekly window is usable", () => {
    const output = formatUsageResults([
      {
        email: "foo@example.com",
        ok: true,
        snapshot: {
          email: "foo@example.com",
          observedEmail: null,
          planType: "free",
          primaryWindow: {
            usedPercent: 0,
            resetAt: "2026-04-13T13:29:00.000Z",
            windowMinutes: 10_080,
          },
          secondaryWindow: null,
          secondaryWindowIssue: "malformed",
          fetchedAt: "2026-04-06T00:00:00.000Z",
        },
      },
    ]);

    expect(output).toContain("Weekly limit : [████████████████████] 100% left");
    expect(output.match(/Weekly limit/g)).toHaveLength(1);
    expect(output).not.toContain("not returned by usage endpoint");
  });

  test("renders annual labels for very long windows", () => {
    const output = formatUsageResults([
      {
        email: "foo@example.com",
        ok: true,
        snapshot: {
          email: "foo@example.com",
          observedEmail: null,
          planType: "enterprise",
          primaryWindow: {
            usedPercent: null,
            resetAt: "2027-04-04T00:00:00.000Z",
            windowMinutes: 60 * 24 * 365,
          },
          secondaryWindow: null,
          secondaryWindowIssue: null,
          fetchedAt: "2026-04-04T00:00:00.000Z",
        },
      },
    ]);

    expect(output).toContain("Annual limit : resets ");
    expect(output).toContain(" on 4 Apr");
  });

  test("keeps an empty plan label unchanged", () => {
    const output = formatUsageResults([
      {
        email: "foo@example.com",
        ok: true,
        snapshot: {
          email: "foo@example.com",
          observedEmail: null,
          planType: "",
          primaryWindow: null,
          secondaryWindow: null,
          secondaryWindowIssue: null,
          fetchedAt: "2026-04-04T00:00:00.000Z",
        },
      },
    ]);

    expect(output).toContain("Plan         : ");
  });

  test("falls back to the raw reset timestamp when the anchor is invalid", () => {
    const output = formatUsageResults([
      {
        email: "foo@example.com",
        ok: true,
        snapshot: {
          email: "foo@example.com",
          observedEmail: null,
          planType: "pro",
          primaryWindow: {
            usedPercent: null,
            resetAt: "2026-04-05T09:30:00.000Z",
            windowMinutes: 300,
          },
          secondaryWindow: null,
          secondaryWindowIssue: null,
          fetchedAt: "not-a-date",
        },
      },
    ]);

    expect(output).toContain("5h limit     : resets 2026-04-05T09:30:00.000Z");
  });

  test("shows monthly labels for month-sized windows", () => {
    const output = formatUsageResults([
      {
        email: "foo@example.com",
        ok: true,
        snapshot: {
          email: "foo@example.com",
          observedEmail: null,
          planType: "pro",
          primaryWindow: {
            usedPercent: 50,
            resetAt: "2026-05-01T00:00:00.000Z",
            windowMinutes: 60 * 24 * 30,
          },
          secondaryWindow: null,
          secondaryWindowIssue: null,
          fetchedAt: "2026-04-04T00:00:00.000Z",
        },
      },
    ]);

    expect(output).toContain("Monthly limit : [██████████░░░░░░░░░░] 50% left");
  });

  test("appends tip when showTip is true", () => {
    const output = formatUsageResults(
      [
        {
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
        },
      ],
      { showTip: true },
    );

    expect(output).toContain("Tip: Run `usage --all` to see all accounts.");
  });

  test("does not append tip when showTip is omitted", () => {
    const output = formatUsageResults([
      {
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
      },
    ]);

    expect(output).not.toContain("Tip:");
  });

  test("marks the current account with a marker when currentEmail is set", () => {
    const output = formatUsageResults(
      [
        {
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
        },
        {
          email: "bar@example.com",
          ok: true,
          snapshot: {
            email: "bar@example.com",
            observedEmail: null,
            planType: "plus",
            primaryWindow: null,
            secondaryWindow: null,
            secondaryWindowIssue: null,
            fetchedAt: "2026-04-04T00:00:00.000Z",
          },
        },
      ],
      { currentEmail: "foo@example.com" },
    );

    expect(output).toContain("▶ foo@example.com (Current)");
    expect(output).not.toContain("▶ bar@example.com");
    expect(output).toContain("bar@example.com");
  });

  test("formats successful and failed results", () => {
    const fetchedAt = "2026-04-04T00:00:00.000Z";
    const primaryResetAt = "2026-04-04T00:00:00.000Z";
    const secondaryResetAt = "2026-04-11T10:19:00.000Z";
    const output = formatUsageResults([
      {
        email: "foo@example.com",
        ok: true,
        snapshot: {
          email: "foo@example.com",
          observedEmail: "admin@northview.jp",
          planType: "pro",
          primaryWindow: {
            usedPercent: 42,
            resetAt: primaryResetAt,
            windowMinutes: 300,
          },
          secondaryWindow: {
            usedPercent: 8,
            resetAt: secondaryResetAt,
            windowMinutes: 10_080,
          },
          secondaryWindowIssue: null,
          fetchedAt,
        },
      },
      {
        email: "bar@example.com",
        ok: false,
        code: "unauthorized",
        error: "denied",
      },
    ]);

    expect(output).toContain("Usage summary (2 accounts)");
    expect(output).toContain("foo@example.com");
    expect(output).not.toContain("Status : ok");
    expect(output).not.toContain("Fetched");
    expect(output).toContain("Plan           : Pro");
    expect(output).toContain("Observed email : admin@northview.jp");
    expect(output).toContain(
      `5h limit       : [████████████░░░░░░░░] 58% left (resets ${formatExpectedReset(primaryResetAt, fetchedAt)})`,
    );
    expect(output).toContain(
      `Weekly limit   : [██████████████████░░] 92% left (resets ${formatExpectedReset(secondaryResetAt, fetchedAt)})`,
    );
    expect(output).toContain("bar@example.com");
    expect(output).toContain("Code   : unauthorized");
    expect(output).toContain("Detail : denied");
  });
});

describe("formatAccountActionResult", () => {
  test("formats removed account output", () => {
    const output = formatAccountActionResult("Removed account", {
      profileId: "profile-1",
      email: "foo@example.com",
      accountId: "acct-1",
      authPath: "/tmp/foo.json",
      createdAt: "2026-04-04T00:00:00.000Z",
      lastUsedAt: "2026-04-04T00:00:00.000Z",
    });

    expect(output).toContain("Removed account");
    expect(output).toContain("Email      : foo@example.com");
    expect(output).toContain("Account ID : acct-1");
  });
});
