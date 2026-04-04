import { readFile } from "node:fs/promises";

import * as v from "valibot";

import type { AppState } from "../types.js";
import { canonicalizeAccountRecord } from "../lib/account-record.js";
import { isFileNotFoundError, writeFileAtomic } from "../lib/fs.js";
import { StateCorruptionError, StateReadError, StateWriteError } from "../lib/errors.js";
import { logDebug, logError, logWarn } from "../lib/log.js";
import { ensureManagedStoragePermissions } from "../lib/managed-storage.js";
import { getStatePath } from "../lib/paths.js";
import { AppStateSchema } from "./schema.js";

export async function loadState(): Promise<AppState> {
  const statePath = getStatePath();
  logDebug("state.load.start", "Loading state file.", { statePath });

  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const state = parseState(parsed);
    logDebug("state.load.success", "Loaded state file.", {
      statePath,
      accountCount: Object.keys(state.accounts).length,
      currentProfileId: state.currentProfileId,
    });
    return state;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      logDebug("state.load.missing", "State file does not exist. Using empty state.", { statePath });
      return createEmptyState();
    }

    if (error instanceof SyntaxError || error instanceof v.ValiError) {
      logWarn("state.load.corrupt", "State file is corrupted.", {
        statePath,
        error,
      });
      throw new StateCorruptionError(`State file is invalid: ${error.message}`, { cause: error });
    }

    logError("state.load.failure", "Failed to read state file.", {
      statePath,
      error,
    });
    throw new StateReadError(`Failed to read state file: ${statePath}`, { cause: error });
  }
}

export async function saveState(state: AppState): Promise<void> {
  const statePath = getStatePath();
  logDebug("state.save.start", "Saving state file.", {
    statePath,
    accountCount: Object.keys(state.accounts).length,
    currentProfileId: state.currentProfileId,
  });
  await ensureManagedStoragePermissions();

  let validatedState: AppState;
  try {
    validatedState = parseState(state);
  } catch (error) {
    logError("state.save.invalid", "Refused to write an invalid state object.", {
      statePath,
      error,
    });
    throw new StateWriteError("Refusing to write an invalid state object.", { cause: error });
  }

  try {
    const serialized = JSON.stringify(toPersistedState(validatedState), null, 2);
    await writeFileAtomic(statePath, serialized);
    logDebug("state.save.success", "Saved state file.", { statePath });
  } catch (error) {
    logError("state.save.failure", "Failed to write state file.", {
      statePath,
      error,
    });
    throw new StateWriteError(`Failed to write state file: ${statePath}`, { cause: error });
  }
}

export function createEmptyState(): AppState {
  return {
    currentProfileId: null,
    accounts: {},
  };
}

function parseState(input: unknown): AppState {
  const parsed = v.parse(AppStateSchema, input);
  return {
    currentProfileId: parsed.currentProfileId,
    accounts: Object.fromEntries(
      Object.entries(parsed.accounts).map(([profileId, account]) => [
        profileId,
        canonicalizeAccountRecord(account),
      ]),
    ),
  };
}

function toPersistedState(state: AppState): unknown {
  return {
    currentProfileId: state.currentProfileId,
    accounts: Object.fromEntries(
      Object.entries(state.accounts).map(([profileId, account]) => [
        profileId,
        {
          profileId: account.profileId,
          email: account.email,
          accountId: account.accountId,
          createdAt: account.createdAt,
          lastUsedAt: account.lastUsedAt,
        },
      ]),
    ),
  };
}
