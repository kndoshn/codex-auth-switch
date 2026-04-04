import { readFile, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { ensureDirectory, readFileIfExists, writeFileAtomic } from "../src/lib/fs.js";

describe("fs helpers", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "codex-auth-switch-fs-"));
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  test("creates directories with 0700 permissions", async () => {
    const dirPath = join(tempDir, "config");
    await ensureDirectory(dirPath);

    const directoryStat = await stat(dirPath);
    expect(directoryStat.mode & 0o777).toBe(0o700);
  });

  test("replaces files atomically and keeps 0600 permissions", async () => {
    const targetPath = join(tempDir, "state.json");
    await writeFile(targetPath, "old", "utf8");

    await writeFileAtomic(targetPath, "new");

    await expect(readFile(targetPath, "utf8")).resolves.toBe("new");

    const fileStat = await stat(targetPath);
    expect(fileStat.mode & 0o777).toBe(0o600);
  });

  test("returns null when a file does not exist", async () => {
    const missingPath = join(tempDir, "missing.txt");

    await expect(readFileIfExists(missingPath)).resolves.toBeNull();
  });

  test("rethrows non-ENOENT read errors", async () => {
    await expect(readFileIfExists(tempDir)).rejects.toMatchObject({
      code: "EISDIR",
    });
  });

  test("cleans up stale tmp files before replacing the target file", async () => {
    const targetPath = join(tempDir, "state.json");
    const staleTmpPath = `${targetPath}.123.456.stale.tmp`;
    await writeFile(staleTmpPath, "stale", "utf8");
    const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(staleTmpPath, staleDate, staleDate);

    await writeFileAtomic(targetPath, "fresh");

    await expect(readFile(targetPath, "utf8")).resolves.toBe("fresh");
    await expect(readFile(staleTmpPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
