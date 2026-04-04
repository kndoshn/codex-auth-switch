import { randomUUID } from "node:crypto";

import { logWarn } from "./log.js";
import { StateCorruptionError } from "./errors.js";
import { getAccountAuthPath } from "./paths.js";
import type { AccountRecord } from "../types.js";

type CreateAccountRecordOptions = {
  profileId?: string;
  now?: string;
};

export function createAccountRecord(
  email: string,
  accountId: string,
  options: CreateAccountRecordOptions = {},
): AccountRecord {
  const profileId = options.profileId ?? randomUUID();
  const authPath = getAccountAuthPath(profileId);
  const now = options.now ?? new Date().toISOString();

  return {
    profileId,
    email,
    accountId,
    authPath,
    createdAt: now,
    lastUsedAt: now,
  };
}

export function deriveManagedAuthPath(profileId: string): string {
  return getAccountAuthPath(profileId);
}

export function canonicalizeAccountRecord(
  account: Omit<AccountRecord, "authPath"> & { authPath?: string | undefined },
): AccountRecord {
  const canonicalAuthPath = deriveManagedAuthPath(account.profileId);
  if (typeof account.authPath === "string" && account.authPath !== canonicalAuthPath) {
    logWarn("state.account.auth_path_normalized", "Normalized a non-canonical managed auth path.", {
      email: account.email,
      profileId: account.profileId,
    });
  }

  return {
    ...account,
    authPath: canonicalAuthPath,
  };
}

export function touchAccount(account: AccountRecord, now = new Date().toISOString()): AccountRecord {
  return {
    ...account,
    lastUsedAt: now,
  };
}

export function assertStoredAccountConsistency(account: AccountRecord, accountId: string): void {
  if (accountId === account.accountId) {
    return;
  }

  logWarn("account.activate.consistency_failure", "Stored auth metadata does not match account metadata.", {
    email: account.email,
    expectedAccountId: account.accountId,
    actualAccountId: accountId,
  });
  throw new StateCorruptionError(
    `Stored auth metadata does not match account metadata for ${account.email}.`,
  );
}
