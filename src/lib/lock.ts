import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { LockAcquisitionError } from "./errors.js";
import { ensureDirectory, hasErrorCode, writeFileAtomic } from "./fs.js";
import { isRecord } from "./guards.js";
import { logDebug, logWarn } from "./log.js";
import { getConfigDir, getLockPath } from "./paths.js";

const LOCK_ACQUIRE_TIMEOUT_MS = 30_000;
const LOCK_RETRY_DELAY_MS = 100;
const LOCK_MISSING_OWNER_GRACE_MS = 5_000;

type LockInfo = {
  pid: number;
  operation: string;
  acquiredAt: string;
};

export async function withExclusiveLock<T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  logDebug("lock.acquire.start", "Attempting to acquire lock.", { operation });
  await acquireLock(operation);

  // Run the critical section outside the acquisition retry loop so its own
  // errors (even EEXIST) are never mistaken for lock contention.
  try {
    await writeLockInfo(operation);
    logDebug("lock.acquire.success", "Acquired lock.", { operation });
    return await fn();
  } finally {
    await rm(getLockPath(), { force: true, recursive: true });
    logDebug("lock.release.success", "Released lock.", { operation });
  }
}

async function acquireLock(operation: string): Promise<void> {
  const startedAt = Date.now();
  await ensureDirectory(getConfigDir());

  while (true) {
    try {
      await mkdir(getLockPath(), { mode: 0o700 });
      return;
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) {
        throw error;
      }
    }

    if (await removeStaleLockIfNeeded()) {
      logWarn("lock.stale.removed", "Removed a stale lock before retrying.", { operation });
      continue;
    }

    if (Date.now() - startedAt >= LOCK_ACQUIRE_TIMEOUT_MS) {
      throw new LockAcquisitionError(`Failed to acquire lock for ${operation}.`);
    }

    logDebug("lock.acquire.retry", "Lock is busy. Waiting before retrying.", { operation });
    await delay(LOCK_RETRY_DELAY_MS);
  }
}

function createLockInfo(operation: string): LockInfo {
  return {
    pid: process.pid,
    operation,
    acquiredAt: new Date().toISOString(),
  };
}

async function writeLockInfo(operation: string): Promise<void> {
  const lockInfoPath = join(getLockPath(), "owner.json");
  await writeFileAtomic(lockInfoPath, JSON.stringify(createLockInfo(operation)));
}

async function removeStaleLockIfNeeded(): Promise<boolean> {
  const lockPath = getLockPath();

  let raw: string;
  try {
    raw = await readFile(join(lockPath, "owner.json"), "utf8");
  } catch {
    try {
      const lockStat = await stat(lockPath);
      if (Date.now() - lockStat.mtimeMs < LOCK_MISSING_OWNER_GRACE_MS) {
        return false;
      }
      await rm(lockPath, { force: true, recursive: true });
      logWarn("lock.stale.missing_owner", "Removed lock without owner metadata.", { lockPath });
      return true;
    } catch {
      return false;
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    await rm(lockPath, { force: true, recursive: true });
    logWarn("lock.stale.invalid_json", "Removed lock with invalid owner metadata.", { lockPath });
    return true;
  }

  if (!isLockInfo(parsed)) {
    await rm(lockPath, { force: true, recursive: true });
    logWarn("lock.stale.invalid_shape", "Removed lock with malformed owner metadata.", { lockPath });
    return true;
  }

  if (!isProcessAlive(parsed.pid)) {
    await rm(lockPath, { force: true, recursive: true });
    logWarn("lock.stale.dead_process", "Removed lock owned by a dead process.", {
      lockPath,
      pid: parsed.pid,
      operation: parsed.operation,
    });
    return true;
  }

  return false;
}

function isLockInfo(value: unknown): value is LockInfo {
  return (
    isRecord(value) &&
    typeof value.pid === "number" &&
    typeof value.operation === "string" &&
    typeof value.acquiredAt === "string"
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return hasErrorCode(error, "EPERM");
  }
}
