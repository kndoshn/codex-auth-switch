import {
  AccountNotFoundError,
  DuplicateAccountError,
  NoCurrentAccountError,
} from "./errors.js";
import type { AccountRecord, AppState } from "../types.js";

export function sortAccountsByEmail(accounts: readonly AccountRecord[]): AccountRecord[] {
  return [...accounts].sort((left, right) => left.email.localeCompare(right.email));
}

export function findAccountByEmail(
  state: AppState,
  email: string,
): AccountRecord | undefined {
  return Object.values(state.accounts).find((account) => account.email === email);
}

export function requireAccountByEmail(state: AppState, email: string): AccountRecord {
  const account = findAccountByEmail(state, email);
  if (!account) {
    throw new AccountNotFoundError(`Account not found: ${email}`);
  }

  return account;
}

export function requireCurrentAccount(state: AppState): AccountRecord {
  if (!state.currentProfileId) {
    throw new NoCurrentAccountError("No current account is set.");
  }

  const account = state.accounts[state.currentProfileId];
  if (!account) {
    throw new NoCurrentAccountError("Current account is missing from state.");
  }

  return account;
}

export function assertEmailAvailable(state: AppState, email: string): void {
  if (findAccountByEmail(state, email)) {
    throw new DuplicateAccountError(`Account already exists: ${email}`);
  }
}

export function upsertAccount(state: AppState, account: AccountRecord): AppState {
  return {
    ...state,
    accounts: {
      ...state.accounts,
      [account.profileId]: account,
    },
  };
}

export function setCurrentProfile(state: AppState, profileId: string): AppState {
  return {
    ...state,
    currentProfileId: profileId,
  };
}

export function removeAccountByProfileId(state: AppState, profileId: string): AppState {
  const nextAccounts = { ...state.accounts };
  delete nextAccounts[profileId];

  return {
    ...state,
    accounts: nextAccounts,
  };
}

export function clearCurrentProfile(state: AppState): AppState {
  return {
    ...state,
    currentProfileId: null,
  };
}
