import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { LockAcquisitionError } from "../src/lib/errors.js";
import { withExclusiveLock } from "../src/lib/lock.js";
import { getLockPath } from "../src/lib/paths.js";
import { withTempHome } from "./helpers/home.js";

describe("withExclusiveLock", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("serializes concurrent operations", async () => {
    await withTempHome(async () => {
      const events: string[] = [];
      let releaseFirst!: () => void;
      let notifyFirstStarted!: () => void;

      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const firstStarted = new Promise<void>((resolve) => {
        notifyFirstStarted = resolve;
      });

      const first = withExclusiveLock("first", async () => {
        events.push("first:start");
        notifyFirstStarted();
        await firstGate;
        events.push("first:end");
      });

      await firstStarted;

      const second = withExclusiveLock("second", async () => {
        events.push("second:start");
      });

      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(events).toEqual(["first:start"]);

      releaseFirst();
      await Promise.all([first, second]);

      expect(events).toEqual(["first:start", "first:end", "second:start"]);
    });
  });

  test("removes a stale lock without owner metadata", async () => {
    await withTempHome(async () => {
      const lockPath = getLockPath();
      await mkdir(lockPath, { recursive: true });
      const staleDate = new Date(Date.now() - 10_000);
      await utimes(lockPath, staleDate, staleDate);

      const result = await withExclusiveLock("recover", async () => "ok");

      expect(result).toBe("ok");
    });
  });

  test("removes a stale lock with invalid owner metadata", async () => {
    await withTempHome(async () => {
      const lockPath = getLockPath();
      await mkdir(lockPath, { recursive: true });
      await writeFile(join(lockPath, "owner.json"), "{", "utf8");

      const result = await withExclusiveLock("recover", async () => "ok");

      expect(result).toBe("ok");
    });
  });

  test("removes a stale lock owned by a dead process", async () => {
    await withTempHome(async () => {
      const lockPath = getLockPath();
      await mkdir(lockPath, { recursive: true });
      await writeFile(
        join(lockPath, "owner.json"),
        JSON.stringify({
          pid: 999_999,
          operation: "stale",
          acquiredAt: "2026-04-05T00:00:00.000Z",
        }),
        "utf8",
      );

      const result = await withExclusiveLock("recover", async () => "ok");

      expect(result).toBe("ok");
    });
  });

  test("times out when the lock is owned by a live process", async () => {
    vi.useFakeTimers();

    await withTempHome(async () => {
      const lockPath = getLockPath();
      await mkdir(lockPath, { recursive: true });
      await writeFile(
        join(lockPath, "owner.json"),
        JSON.stringify({
          pid: process.pid,
          operation: "busy",
          acquiredAt: "2026-04-05T00:00:00.000Z",
        }),
        "utf8",
      );

      const pending = withExclusiveLock("blocked", async () => "never");
      await vi.advanceTimersByTimeAsync(30_500);

      await expect(pending).rejects.toBeInstanceOf(LockAcquisitionError);
    });
  });
});
