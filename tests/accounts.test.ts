import { describe, expect, test } from "vitest";

import {
  assertEmailAvailable,
  clearCurrentProfile,
  removeAccountByProfileId,
  requireAccountByEmail,
  requireCurrentAccount,
  setCurrentProfile,
  sortAccountsByEmail,
  upsertAccount,
} from "../src/lib/accounts.js";
import {
  AccountNotFoundError,
  DuplicateAccountError,
  NoCurrentAccountError,
} from "../src/lib/errors.js";
import type { AccountRecord, AppState } from "../src/types.js";

function createAccount(profileId: string, email: string): AccountRecord {
  return {
    profileId,
    email,
    accountId: `acct-${profileId}`,
    authPath: `/tmp/${profileId}.json`,
    createdAt: "2026-04-04T00:00:00.000Z",
    lastUsedAt: "2026-04-04T00:00:00.000Z",
  };
}

describe("account helpers", () => {
  test("sorts accounts by normalized email order", () => {
    const accounts = [
      createAccount("c", "charlie@example.com"),
      createAccount("a", "alpha@example.com"),
      createAccount("b", "bravo@example.com"),
    ];

    expect(sortAccountsByEmail(accounts).map((account) => account.email)).toEqual([
      "alpha@example.com",
      "bravo@example.com",
      "charlie@example.com",
    ]);
  });

  test("throws typed errors for missing or duplicate accounts", () => {
    const state: AppState = {
      currentProfileId: "alpha",
      accounts: {
        alpha: createAccount("alpha", "alpha@example.com"),
      },
    };

    expect(() => requireAccountByEmail(state, "missing@example.com")).toThrow(
      AccountNotFoundError,
    );
    expect(() => assertEmailAvailable(state, "alpha@example.com")).toThrow(
      DuplicateAccountError,
    );
  });

  test("returns and updates the current account through pure helpers", () => {
    const alpha = createAccount("alpha", "alpha@example.com");
    const bravo = createAccount("bravo", "bravo@example.com");

    const initialState: AppState = {
      currentProfileId: null,
      accounts: {
        alpha,
      },
    };

    expect(() => requireCurrentAccount(initialState)).toThrow(NoCurrentAccountError);

    const updatedState = setCurrentProfile(
      upsertAccount(initialState, bravo),
      "bravo",
    );

    expect(requireCurrentAccount(updatedState)).toMatchObject({
      profileId: "bravo",
      email: "bravo@example.com",
    });
  });

  test("removes an account and clears the current profile through pure helpers", () => {
    const alpha = createAccount("alpha", "alpha@example.com");
    const bravo = createAccount("bravo", "bravo@example.com");

    const state: AppState = {
      currentProfileId: "bravo",
      accounts: {
        alpha,
        bravo,
      },
    };

    const nextState = clearCurrentProfile(removeAccountByProfileId(state, "bravo"));

    expect(nextState.currentProfileId).toBeNull();
    expect(nextState.accounts).toEqual({
      alpha,
    });
  });
});
