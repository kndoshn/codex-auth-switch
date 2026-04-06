import { describe, expect, test } from "vitest";

import { UsageFetchError } from "../src/lib/errors.js";
import { allUsageResultsFailed, toUsageFailure, toUsageSnapshot } from "../src/lib/usage.js";
import type { UsageResult } from "../src/types.js";

describe("usage helpers", () => {
  test("maps a valid payload into a snapshot", () => {
    const snapshot = toUsageSnapshot({
      plan_type: "pro",
      rate_limit: {
        primary_window: {
          used_percent: 24,
          limit_window_seconds: 18_000,
          reset_at: 1_775_300_000,
        },
        secondary_window: {
          used_percent: 11,
          window_minutes: 10_080,
          reset_at: 1_775_400_000,
        },
      },
    }, "foo@example.com");

    expect(snapshot).toMatchObject({
      email: "foo@example.com",
      observedEmail: null,
      planType: "pro",
      primaryWindow: {
        usedPercent: 24,
        windowMinutes: 300,
      },
      secondaryWindow: {
        usedPercent: 11,
        windowMinutes: 10_080,
      },
      secondaryWindowIssue: null,
    });
  });

  test("throws a typed error for malformed payloads", () => {
    expect(() => toUsageSnapshot({ plan_type: "pro" }, "foo@example.com")).toThrow(
      UsageFetchError,
    );
  });

  test("captures the observed email returned by the usage endpoint", () => {
    const snapshot = toUsageSnapshot({
      email: " Admin@Northview.jp ",
      plan_type: "pro",
      rate_limit: {
        primary_window: {
          used_percent: 24,
          reset_at: 1_775_300_000,
        },
      },
    }, "label@example.com");

    expect(snapshot.observedEmail).toBe("admin@northview.jp");
  });

  test("throws when primary_window is present but malformed", () => {
    expect(() =>
      toUsageSnapshot({
        rate_limit: {
          primary_window: {
            used_percent: "bad",
            reset_at: 1_775_300_000,
          },
        },
      }, "foo@example.com"),
    ).toThrow(UsageFetchError);
  });

  test("treats a malformed secondary_window as unavailable", () => {
    const snapshot = toUsageSnapshot({
      rate_limit: {
        secondary_window: {
          used_percent: 10,
          reset_at: "bad",
        },
      },
    }, "foo@example.com");

    expect(snapshot.secondaryWindow).toBeNull();
    expect(snapshot.secondaryWindowIssue).toBe("malformed");
  });

  test("normalizes failures into typed result metadata", () => {
    expect(toUsageFailure(new UsageFetchError("unauthorized", "denied"))).toEqual({
      code: "unauthorized",
      message: "denied",
    });

    expect(toUsageFailure(new Error("offline"))).toEqual({
      code: "network_error",
      message: "offline",
    });

    expect(toUsageFailure("offline")).toEqual({
      code: "network_error",
      message: "Unknown usage failure.",
    });
  });

  test("detects when every usage result failed", () => {
    const allFailed: UsageResult[] = [
      { email: "a@example.com", ok: false, code: "auth_missing", error: "missing" },
      { email: "b@example.com", ok: false, code: "network_error", error: "offline" },
    ];
    const mixed: UsageResult[] = [
      { email: "a@example.com", ok: false, code: "auth_missing", error: "missing" },
      {
        email: "b@example.com",
        ok: true,
        snapshot: {
          email: "b@example.com",
          observedEmail: null,
          planType: "pro",
          primaryWindow: null,
          secondaryWindow: null,
          secondaryWindowIssue: null,
          fetchedAt: "2026-04-04T00:00:00.000Z",
        },
      },
    ];

    expect(allUsageResultsFailed(allFailed)).toBe(true);
    expect(allUsageResultsFailed(mixed)).toBe(false);
    expect(allUsageResultsFailed([])).toBe(false);
  });
});
