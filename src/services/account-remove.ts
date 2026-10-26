import { rm } from "node:fs/promises";

import {
  ActiveAccountRemovalError,
  AuthReadError,
  AuthWriteError,
} from "../lib/errors.js";
import {
  clearCurrentProfile,
  removeAccountByProfileId,
  requireAccountByEmail,
} from "../lib/accounts.js";
import { extractAccountId, writeAuthFile } from "../lib/auth.js";
import { requireFileBasedCodexAuthSource } from "../lib/codex-auth-source.js";
import { readFileIfExists } from "../lib/fs.js";
import { logDebug, logWarn } from "../lib/log.js";
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

  const activeAuthSource = await requireFileBasedCodexAuthSource(getActiveCodexHome());
  const rollbackFiles: RemovedAuthFile[] = [
    { path: account.authPath, raw: await readExistingFile(account.authPath) },
  ];

  // Only sign out of the live session when it belongs to the removed account.
  // A missing file (logout) or another identity (external login) stays untouched.
  const liveAuthRaw = await readExistingFile(activeAuthSource.authPath);
  if (liveAuthRaw !== null && extractAccountId(liveAuthRaw) === account.accountId) {
    rollbackFiles.push({ path: activeAuthSource.authPath, raw: liveAuthRaw });
  } else {
    logWarn("account.remove.live_auth.skip", "Live auth does not belong to the removed account. Leaving it untouched.", {
      email: account.email,
      liveAuthMissing: liveAuthRaw === null,
    });
  }

  const nextState = clearCurrentProfile(removeAccountByProfileId(state, account.profileId));
  await performRemovalTransaction({
    email: account.email,
    options,
    nextState,
    rollbackFiles,
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

// Removes every file in rollbackFiles, then saves state. Any failure restores
// the files to their captured contents.
async function performRemovalTransaction(params: {
  email: string;
  options: RemoveAccountOptions;
  nextState: AppState;
  rollbackFiles: RemovedAuthFile[];
}): Promise<void> {
  params.options.onStageChange?.("removing_auth");
  try {
    for (const file of params.rollbackFiles) {
      await removeAuthFile(file.path);
    }

    params.options.onStageChange?.("saving_state");
    await saveState(params.nextState);
  } catch (error) {
    await rollbackRemovedFiles(params.rollbackFiles, params.email);
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
