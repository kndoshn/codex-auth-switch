import {
  requireAccountByEmail,
  requireCurrentAccount,
  sortAccountsByEmail,
} from "../lib/accounts.js";
import { normalizeEmail } from "../lib/email.js";
import { logDebug } from "../lib/log.js";
import { withExclusiveLock } from "../lib/lock.js";
import type { AccountRecord } from "../types.js";
import { loadState } from "../state/store.js";
import {
  addAccountWithLogin,
  type AddAccountOptions,
  type AddAccountStage,
} from "./account-add.js";
import {
  activateStoredAccount,
  type ActivateAccountOptions,
  type ActivateAccountStage,
} from "./account-activation.js";
import {
  removeStoredAccount,
  type RemoveAccountOptions,
  type RemoveAccountStage,
} from "./account-remove.js";

export async function listAccounts(): Promise<{
  accounts: AccountRecord[];
  currentProfileId: string | null;
}> {
  const state = await loadState();

  return {
    accounts: sortAccountsByEmail(Object.values(state.accounts)),
    currentProfileId: state.currentProfileId,
  };
}

export async function getAccountByEmail(email: string): Promise<AccountRecord> {
  const normalizedEmail = normalizeEmail(email);
  const state = await loadState();
  return requireAccountByEmail(state, normalizedEmail);
}

export async function getCurrentAccount(): Promise<AccountRecord> {
  const state = await loadState();
  return requireCurrentAccount(state);
}

export async function addAccount(email: string, options: AddAccountOptions = {}): Promise<AccountRecord> {
  const normalizedEmail = normalizeEmail(email);
  logDebug("account.add.start", "Starting account registration.", { email: normalizedEmail });
  const account = await addAccountWithLogin(normalizedEmail, options);
  logDebug("account.add.success", "Registered account.", {
    email: account.email,
    profileId: account.profileId,
    accountId: account.accountId,
  });
  return account;
}

export async function activateAccount(email: string, options: ActivateAccountOptions = {}): Promise<AccountRecord> {
  const normalizedEmail = normalizeEmail(email);
  logDebug("account.activate.start", "Activating account.", { email: normalizedEmail });

  return withExclusiveLock("use", async () => activateStoredAccount(normalizedEmail, options));
}

export async function removeAccount(email: string, options: RemoveAccountOptions = {}): Promise<AccountRecord> {
  const normalizedEmail = normalizeEmail(email);
  logDebug("account.remove.start", "Removing account.", { email: normalizedEmail });
  const account = await withExclusiveLock("remove", async () => removeStoredAccount(normalizedEmail, options));
  logDebug("account.remove.success", "Removed account.", {
    email: account.email,
    profileId: account.profileId,
    accountId: account.accountId,
  });
  return account;
}

export type {
  AddAccountOptions,
  AddAccountStage,
  ActivateAccountOptions,
  ActivateAccountStage,
  RemoveAccountOptions,
  RemoveAccountStage,
};
