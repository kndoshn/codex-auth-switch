import { describe, expect, test } from "vitest";

import {
  assertStoredAccountConsistency,
  createAccountRecord,
  touchAccount,
} from "../src/lib/account-record.js";
import { StateCorruptionError } from "../src/lib/errors.js";

describe("account record helpers", () => {
  test("createAccountRecord builds a stable record when deps are supplied", () => {
    expect(createAccountRecord("foo@example.com", "acct-1", {
      profileId: "profile-1",
      now: "2026-04-04T00:00:00.000Z",
    })).toEqual({
      profileId: "profile-1",
      email: "foo@example.com",
      accountId: "acct-1",
      authPath: expect.stringContaining("/profile-1.json"),
      createdAt: "2026-04-04T00:00:00.000Z",
      lastUsedAt: "2026-04-04T00:00:00.000Z",
    });
  });

  test("touchAccount updates only lastUsedAt", () => {
    const account = createAccountRecord("foo@example.com", "acct-1", {
      profileId: "profile-1",
      now: "2026-04-04T00:00:00.000Z",
    });

    expect(touchAccount(account, "2026-04-05T00:00:00.000Z")).toEqual({
      ...account,
      lastUsedAt: "2026-04-05T00:00:00.000Z",
    });
  });

  test("assertStoredAccountConsistency accepts matching account ids", () => {
    const account = createAccountRecord("foo@example.com", "acct-1", {
      profileId: "profile-1",
      now: "2026-04-04T00:00:00.000Z",
    });

    expect(() => assertStoredAccountConsistency(account, "acct-1")).not.toThrow();
  });

  test("assertStoredAccountConsistency rejects mismatched account ids", () => {
    const account = createAccountRecord("foo@example.com", "acct-1", {
      profileId: "profile-1",
      now: "2026-04-04T00:00:00.000Z",
    });

    expect(() => assertStoredAccountConsistency(account, "acct-2")).toThrow(StateCorruptionError);
  });
});
