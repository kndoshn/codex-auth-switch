import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { execa } from "execa";

import type { AccountRecord, StoredAuthFile } from "../types.js";
import { CodexLoginFailedError } from "../lib/errors.js";
import { assertEmailAvailable, setCurrentProfile, upsertAccount } from "../lib/accounts.js";
import { createAccountRecord, deriveManagedAuthPath } from "../lib/account-record.js";
import { readAuthFile, writeAuthFile } from "../lib/auth.js";
import { requireFileBasedCodexAuthSource } from "../lib/codex-auth-source.js";
import { readFileIfExists } from "../lib/fs.js";
import { logDebug, logError, logWarn } from "../lib/log.js";
import { withExclusiveLock } from "../lib/lock.js";
import { ensureManagedStoragePermissions } from "../lib/managed-storage.js";
import { getCodexAuthPath } from "../lib/paths.js";
import { loadState, saveState } from "../state/store.js";

export type AddAccountStage =
  | "validating_email"
  | "preparing_login"
  | "awaiting_login"
  | "saving_account";

export type AddAccountOptions = {
  onStageChange?: (stage: AddAccountStage) => void;
};

export async function addAccountWithLogin(
  email: string,
  options: AddAccountOptions = {},
): Promise<AccountRecord> {
  options.onStageChange?.("validating_email");
  const preflightState = await loadState();
  assertEmailAvailable(preflightState, email);

  options.onStageChange?.("preparing_login");
  const tempHome = await mkdtemp(join(tmpdir(), "codex-auth-switch-add-"));
  logDebug("account.add.temp_home.created", "Created temporary CODEX_HOME.", { tempHome });

  try {
    options.onStageChange?.("awaiting_login");
    await runCodexLogin(tempHome);

    const tempAuthSource = await requireFileBasedCodexAuthSource(tempHome);
    const tempAuth = await readAuthFile(tempAuthSource.authPath);
    options.onStageChange?.("saving_account");

    return withExclusiveLock("add", async () => persistRegisteredAccount(email, tempAuth));
  } finally {
    await rm(tempHome, { force: true, recursive: true }).catch((error: unknown) => {
      logWarn("account.add.temp_home.cleanup_failed", "Failed to remove temporary CODEX_HOME.", {
        tempHome,
        error,
      });
    });
  }
}

export async function persistRegisteredAccount(
  email: string,
  tempAuth: StoredAuthFile,
): Promise<AccountRecord> {
  const state = await loadState();
  assertEmailAvailable(state, email);
  await ensureManagedStoragePermissions();

  const account = createAccountRecord(email, tempAuth.accountId);
  await writeAuthFile(deriveManagedAuthPath(account.profileId), tempAuth.raw);

  const shouldAutoActivate = !state.currentProfileId;
  const currentAuthPath = getCodexAuthPath();
  const previousActiveAuth = shouldAutoActivate ? await readFileIfExists(currentAuthPath) : null;
  let nextState = upsertAccount(state, account);

  if (shouldAutoActivate) {
    logDebug("account.add.auto_activate", "No active account. Auto-activating the newly added account.", {
      email,
      profileId: account.profileId,
    });
    await writeAuthFile(currentAuthPath, tempAuth.raw);
    nextState = setCurrentProfile(nextState, account.profileId);
  }

  try {
    await saveState(nextState);
  } catch (error) {
    logError("account.add.state_save_failure", "Failed to save state for the new account.", {
      email,
      profileId: account.profileId,
      error,
    });
    if (shouldAutoActivate) {
      await restorePreviousActiveAuth(currentAuthPath, previousActiveAuth);
    }
    const managedAuthPath = deriveManagedAuthPath(account.profileId);
    await rm(managedAuthPath, { force: true }).catch((cleanupError: unknown) => {
      logWarn("account.add.rollback.cleanup_failed", "Failed to remove auth file during rollback.", {
        authPath: managedAuthPath,
        cleanupError,
      });
    });
    throw error;
  }

  return account;
}

async function restorePreviousActiveAuth(
  currentAuthPath: string,
  previousActiveAuth: string | null,
): Promise<void> {
  try {
    if (previousActiveAuth === null) {
      await rm(currentAuthPath, { force: true });
      return;
    }

    await writeAuthFile(currentAuthPath, previousActiveAuth);
  } catch (cleanupError) {
    logWarn("account.add.rollback.active_auth_restore_failed", "Failed to restore the active auth file during rollback.", {
      authPath: currentAuthPath,
      cleanupError,
    });
  }
}

async function runCodexLogin(homeDir: string): Promise<void> {
  logDebug("codex.login.start", "Starting codex login.", { homeDir });
  try {
    const result = await execa("codex", ["login"], {
      env: {
        ...process.env,
        CODEX_HOME: homeDir,
      },
      stdio: "inherit",
    });

    if (result.exitCode !== 0) {
      logWarn("codex.login.non_zero_exit", "codex login exited with a non-zero code.", {
        homeDir,
        exitCode: result.exitCode,
      });
      throw new CodexLoginFailedError(`codex login exited with code ${result.exitCode}.`);
    }

    logDebug("codex.login.success", "codex login completed successfully.", { homeDir });
  } catch (error) {
    if (error instanceof CodexLoginFailedError) {
      throw error;
    }

    logError("codex.login.failure", "codex login failed before completion.", {
      homeDir,
      error,
    });
    throw new CodexLoginFailedError("codex login failed.", { cause: error });
  }
}
