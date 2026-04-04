import { describe, expect, test } from "vitest";

import { formatAccountList, formatUsageResults } from "../src/lib/format.js";

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
    expect(output).toContain("Active");
    expect(output).toContain("yes     bar@example.com");
    expect(output).toContain("foo@example.com");
    expect(output).toContain("2026-04-04");
    expect(output).toContain("local");
  });
});

describe("formatUsageResults", () => {
  test("returns a fallback message when there are no results", () => {
    expect(formatUsageResults([])).toBe("No usage data.");
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
    expect(output).toContain("Plan           : pro");
    expect(output).toContain("Observed email : admin@northview.jp");
    expect(output).toContain(
      `5h limit       : 58% left (resets ${formatExpectedReset(primaryResetAt, fetchedAt)})`,
    );
    expect(output).toContain(
      `Weekly limit   : 92% left (resets ${formatExpectedReset(secondaryResetAt, fetchedAt)})`,
    );
    expect(output).toContain("Fetched        :");
    expect(output).not.toContain(`Fetched        : ${fetchedAt}`);
    expect(output).toContain("local");
    expect(output).toContain("bar@example.com");
    expect(output).toContain("Code   : unauthorized");
    expect(output).toContain("Detail : denied");
  });
});
