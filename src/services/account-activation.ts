import { rm } from "node:fs/promises";

import type { AccountRecord, AppState } from "../types.js";
import { AuthReadError, AuthWriteError, UnsupportedCredentialStoreError } from "../lib/errors.js";
import {
  requireAccountByEmail,
  requireCurrentAccount,
  setCurrentProfile,
  upsertAccount,
} from "../lib/accounts.js";
import { assertStoredAccountConsistency, deriveManagedAuthPath, touchAccount } from "../lib/account-record.js";
import { readAuthFile, writeAuthFile } from "../lib/auth.js";
import { resolveCodexAuthSource } from "../lib/codex-auth-source.js";
import { ensureFileModeIfExists, readFileIfExists } from "../lib/fs.js";
import { logDebug, logError, logWarn } from "../lib/log.js";
import { ensureManagedAuthFilePermissions } from "../lib/managed-storage.js";
import { assertNoRunningCodexProcess } from "../lib/process.js";
import { getActiveCodexHome } from "../lib/paths.js";
import { loadState, saveState } from "../state/store.js";

export type ActivateAccountStage =
  | "checking_processes"
  | "loading_account"
  | "writing_auth"
  | "saving_state";

export type ActivateAccountOptions = {
  onStageChange?: (stage: ActivateAccountStage) => void;
};

export async function activateStoredAccount(
  email: string,
  options: ActivateAccountOptions = {},
): Promise<AccountRecord> {
  options.onStageChange?.("checking_processes");
  await assertNoRunningCodexProcess();

  options.onStageChange?.("loading_account");
  const state = await loadState();
  const activeAuthSource = await resolveCodexAuthSource(getActiveCodexHome());
  if (activeAuthSource.resolvedMode === "keyring") {
    throw new UnsupportedCredentialStoreError(
      `Codex is configured to use ${activeAuthSource.configuredMode} credential storage in ${activeAuthSource.homeDir}.`,
    );
  }
  const currentAuthPath = activeAuthSource.authPath;
  const syncResult = await syncCurrentActiveAccountSnapshot(state, currentAuthPath);
  const stateWithSyncedCurrent = syncResult.state;
  const account = requireAccountByEmail(stateWithSyncedCurrent, email);
  const targetAuthPath = await ensureManagedAuthFilePermissions(account.profileId);
  const targetAuth = await readAuthFile(targetAuthPath);
  assertStoredAccountConsistency(account, targetAuth.accountId);

  const previousAuth = syncResult.previousAuth ?? await readExistingFile(currentAuthPath);

  options.onStageChange?.("writing_auth");
  await writeAuthFile(currentAuthPath, targetAuth.raw);

  const updatedAccount = touchAccount(account);
  const nextState = setCurrentProfile(
    upsertAccount(stateWithSyncedCurrent, updatedAccount),
    updatedAccount.profileId,
  );

  try {
    options.onStageChange?.("saving_state");
    await saveState(nextState);
  } catch (error) {
    await rollbackActivatedAuth(email, currentAuthPath, previousAuth);
    throw error;
  }

  logDebug("account.activate.success", "Activated account.", {
    email: updatedAccount.email,
    profileId: updatedAccount.profileId,
  });
  return updatedAccount;
}

export async function syncCurrentActiveAccountSnapshot(
  state: AppState,
  activeAuthPath: string,
): Promise<{ state: AppState; previousAuth: string | null }> {
  if (!state.currentProfileId) {
    return {
      state,
      previousAuth: null,
    };
  }

  const currentAccount = requireCurrentAccount(state);
  const activeAuth = await readAuthFile(activeAuthPath);
  assertStoredAccountConsistency(currentAccount, activeAuth.accountId);

  const managedAuthPath = await ensureManagedAuthFilePermissions(currentAccount.profileId);
  const storedAuth = await readAuthFile(managedAuthPath);
  if (storedAuth.raw === activeAuth.raw) {
    logDebug("account.sync_current.noop", "Current account auth is already synchronized.", {
      email: currentAccount.email,
      profileId: currentAccount.profileId,
    });
    return {
      state,
      previousAuth: activeAuth.raw,
    };
  }

  logDebug("account.sync_current.write", "Persisting the current active auth back into managed storage.", {
    email: currentAccount.email,
    profileId: currentAccount.profileId,
  });
  await writeAuthFile(managedAuthPath, activeAuth.raw);
  return {
    state: upsertAccount(state, currentAccount),
    previousAuth: activeAuth.raw,
  };
}

export async function readExistingFile(path: string): Promise<string | null> {
  logDebug("auth.current.read.start", "Reading current auth file before switch.", { path });
  try {
    const raw = await readFileIfExists(path);
    if (raw === null) {
      logDebug("auth.current.read.missing", "Current auth file does not exist.", { path });
      return null;
    }

    logDebug("auth.current.read.success", "Read current auth file before switch.", { path });
    return raw;
  } catch (error) {
    logError("auth.current.read.failure", "Failed to read the current auth file before switch.", {
      path,
      error,
    });
    throw new AuthReadError(`Failed to read existing auth file: ${path}`, {
      cause: error,
    });
  }
}

export async function restorePreviousAuth(
  currentAuthPath: string,
  previousAuth: string | null,
): Promise<void> {
  if (previousAuth === null) {
    logDebug("auth.restore.remove", "Removing current auth file during rollback.", { currentAuthPath });
    await rm(currentAuthPath, { force: true });
    return;
  }

  logDebug("auth.restore.write", "Restoring previous auth file during rollback.", { currentAuthPath });
  await writeAuthFile(currentAuthPath, previousAuth);
}

export async function rollbackActivatedAuth(
  email: string,
  currentAuthPath: string,
  previousAuth: string | null,
): Promise<void> {
  try {
    logWarn("account.activate.rollback.start", "State save failed. Restoring previous auth.", {
      email,
    });
    await restorePreviousAuth(currentAuthPath, previousAuth);
    logWarn("account.activate.rollback.success", "Restored previous auth after state save failure.", {
      email,
    });
  } catch (restoreError) {
    throw new AuthWriteError("Failed to restore previous auth after state update failure.", {
      cause: restoreError,
    });
  }
}
