import { rm } from "node:fs/promises";

import {
  ActiveAccountRemovalError,
  AuthReadError,
  AuthWriteError,
  UnsupportedCredentialStoreError,
} from "../lib/errors.js";
import {
  clearCurrentProfile,
  removeAccountByProfileId,
  requireAccountByEmail,
} from "../lib/accounts.js";
import { assertStoredAccountConsistency } from "../lib/account-record.js";
import { readAuthFile, writeAuthFile } from "../lib/auth.js";
import { resolveCodexAuthSource } from "../lib/codex-auth-source.js";
import { readFileIfExists } from "../lib/fs.js";
import { logDebug, logWarn } from "../lib/log.js";
import { ensureManagedStoragePermissions } from "../lib/managed-storage.js";
import { assertNoRunningCodexProcess } from "../lib/process.js";
import { getActiveCodexHome } from "../lib/paths.js";
import type { AccountRecord, AppState } from "../types.js";
import { loadState, saveState } from "../state/store.js";

export type RemoveAccountStage =
  | "loading_account"
  | "checking_processes"
  | "removing_auth"
  | "saving_state";

export type RemoveAccountOptions = {
  onStageChange?: (stage: RemoveAccountStage) => void;
};

type RemovedAuthFile = {
  path: string;
  raw: string | null;
};

export async function removeStoredAccount(
  email: string,
  options: RemoveAccountOptions = {},
): Promise<AccountRecord> {
  options.onStageChange?.("loading_account");
  const state = await loadState();
  const account = requireAccountByEmail(state, email);

  if (!isCurrentAccount(state, account.profileId)) {
    return removeInactiveAccount(state, account, options);
  }

  if (Object.keys(state.accounts).length > 1) {
    throw new ActiveAccountRemovalError(
      `Refusing to remove active account ${email} while other saved accounts remain.`,
    );
  }

  return removeSoleActiveAccount(state, account, options);
}

async function removeInactiveAccount(
  state: AppState,
  account: AccountRecord,
  options: RemoveAccountOptions,
): Promise<AccountRecord> {
  const nextState = removeAccountByProfileId(state, account.profileId);
  await performRemovalTransaction({
    email: account.email,
    options,
    nextState,
    rollbackFiles: [
      { path: account.authPath, raw: await readExistingFile(account.authPath) },
    ],
    removePaths: [account.authPath],
  });

  logDebug("account.remove.success", "Removed inactive account.", {
    email: account.email,
    profileId: account.profileId,
  });
  return account;
}

async function removeSoleActiveAccount(
  state: AppState,
  account: AccountRecord,
  options: RemoveAccountOptions,
): Promise<AccountRecord> {
  options.onStageChange?.("checking_processes");
  await assertNoRunningCodexProcess();

  const activeAuthSource = await resolveCodexAuthSource(getActiveCodexHome());
  if (activeAuthSource.resolvedMode === "keyring") {
    throw new UnsupportedCredentialStoreError(
      `Codex is configured to use ${activeAuthSource.configuredMode} credential storage in ${activeAuthSource.homeDir}.`,
    );
  }

  if (activeAuthSource.resolvedMode !== "file") {
    throw new UnsupportedCredentialStoreError(
      `Codex credential storage could not be resolved to file mode in ${activeAuthSource.homeDir}.`,
    );
  }

  const managedAuthSnapshot = await readExistingFile(account.authPath);
  const activeAuth = await readAuthFile(activeAuthSource.authPath);
  assertStoredAccountConsistency(account, activeAuth.accountId);
  const rollbackFiles = [
    { path: account.authPath, raw: managedAuthSnapshot },
    { path: activeAuthSource.authPath, raw: activeAuth.raw },
  ];
  await ensureManagedStoragePermissions();
  if (managedAuthSnapshot !== activeAuth.raw) {
    logDebug("account.remove.sync_current.write", "Persisting active auth into managed storage before removal.", {
      email: account.email,
      profileId: account.profileId,
    });
    await writeAuthFile(account.authPath, activeAuth.raw);
  }

  const nextState = clearCurrentProfile(removeAccountByProfileId(state, account.profileId));
  await performRemovalTransaction({
    email: account.email,
    options,
    nextState,
    rollbackFiles,
    removePaths: [account.authPath, activeAuthSource.authPath],
    rollbackOnFailure: true,
  });

  logDebug("account.remove.success", "Removed sole active account.", {
    email: account.email,
    profileId: account.profileId,
  });
  return account;
}

function isCurrentAccount(state: AppState, profileId: string): boolean {
  return state.currentProfileId === profileId;
}

async function removeAuthFile(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch (error) {
    throw new AuthWriteError(`Failed to remove auth file: ${path}`, { cause: error });
  }
}

async function performRemovalTransaction(params: {
  email: string;
  options: RemoveAccountOptions;
  nextState: AppState;
  rollbackFiles: RemovedAuthFile[];
  removePaths: string[];
  rollbackOnFailure?: boolean;
}): Promise<void> {
  let shouldRollback = params.rollbackOnFailure ?? false;

  try {
    params.options.onStageChange?.("removing_auth");
    shouldRollback = true;
    for (const path of params.removePaths) {
      await removeAuthFile(path);
    }

    params.options.onStageChange?.("saving_state");
    await saveState(params.nextState);
  } catch (error) {
    if (shouldRollback) {
      await rollbackRemovedFiles(params.rollbackFiles, params.email);
    }
    throw error;
  }
}

async function rollbackRemovedFiles(
  files: RemovedAuthFile[],
  email: string,
): Promise<void> {
  logWarn("account.remove.rollback.start", "State save failed. Restoring removed auth files.", {
    email,
    fileCount: files.length,
  });

  try {
    for (const file of files) {
      await restoreRemovedFile(file);
    }
    logWarn("account.remove.rollback.success", "Restored removed auth files after state save failure.", {
      email,
      fileCount: files.length,
    });
  } catch (restoreError) {
    throw new AuthWriteError("Failed to restore auth files after state update failure.", {
      cause: restoreError,
    });
  }
}

async function restoreRemovedFile(file: RemovedAuthFile): Promise<void> {
  if (file.raw === null) {
    await removeAuthFile(file.path);
    return;
  }

  await writeAuthFile(file.path, file.raw);
}

async function readExistingFile(path: string): Promise<string | null> {
  try {
    return await readFileIfExists(path);
  } catch (error) {
    throw new AuthReadError(`Failed to read existing auth file: ${path}`, {
      cause: error,
    });
  }
}
