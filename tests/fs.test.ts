import { chmod, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  ensureDirectory,
  ensureDirectoryModeIfExists,
  ensureFileModeIfExists,
  hasErrorCode,
  isFileNotFoundError,
  readFileIfExists,
  writeFileAtomic,
} from "../src/lib/fs.js";

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

  test("normalizes existing directory permissions when needed", async () => {
    const dirPath = join(tempDir, "config");
    await ensureDirectory(dirPath);
    await chmod(dirPath, 0o755);

    await ensureDirectoryModeIfExists(dirPath, 0o700);

    const directoryStat = await stat(dirPath);
    expect(directoryStat.mode & 0o777).toBe(0o700);
  });

  test("ignores missing paths and non-directories when normalizing directory permissions", async () => {
    const filePath = join(tempDir, "state.json");
    await writeFile(filePath, "{}", "utf8");

    await expect(ensureDirectoryModeIfExists(join(tempDir, "missing"), 0o700)).resolves.toBeUndefined();
    await expect(ensureDirectoryModeIfExists(filePath, 0o700)).resolves.toBeUndefined();
  });

  test("replaces files atomically and keeps 0600 permissions", async () => {
    const targetPath = join(tempDir, "state.json");
    await writeFile(targetPath, "old", "utf8");

    await writeFileAtomic(targetPath, "new");

    await expect(readFile(targetPath, "utf8")).resolves.toBe("new");

    const fileStat = await stat(targetPath);
    expect(fileStat.mode & 0o777).toBe(0o600);
  });

  test("normalizes existing file permissions when needed", async () => {
    const targetPath = join(tempDir, "state.json");
    await writeFile(targetPath, "{}", { encoding: "utf8", mode: 0o644 });

    await ensureFileModeIfExists(targetPath, 0o600);

    const fileStat = await stat(targetPath);
    expect(fileStat.mode & 0o777).toBe(0o600);
  });

  test("ignores missing paths and non-files when normalizing file permissions", async () => {
    const dirPath = join(tempDir, "config");
    await ensureDirectory(dirPath);

    await expect(ensureFileModeIfExists(join(tempDir, "missing"), 0o600)).resolves.toBeUndefined();
    await expect(ensureFileModeIfExists(dirPath, 0o600)).resolves.toBeUndefined();
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

  test("keeps recent tmp files when replacing the target file", async () => {
    const targetPath = join(tempDir, "state.json");
    const recentTmpPath = `${targetPath}.123.456.recent.tmp`;
    await writeFile(recentTmpPath, "recent", "utf8");

    await writeFileAtomic(targetPath, "fresh");

    await expect(readFile(targetPath, "utf8")).resolves.toBe("fresh");
    await expect(readFile(recentTmpPath, "utf8")).resolves.toBe("recent");
  });

  test("removes stale tmp files when replacing the target file", async () => {
    const targetPath = join(tempDir, "state.json");
    const staleTmpPath = `${targetPath}.123.456.stale.tmp`;
    await writeFile(staleTmpPath, "stale", "utf8");
    const staleDate = new Date(Date.now() - (2 * 60 * 60 * 1000));
    await utimes(staleTmpPath, staleDate, staleDate);

    await writeFileAtomic(targetPath, "fresh");

    await expect(readFile(targetPath, "utf8")).resolves.toBe("fresh");
    await expect(readFile(staleTmpPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test.each([
    { name: "directory", normalize: ensureDirectoryModeIfExists, mode: 0o700 },
    { name: "file", normalize: ensureFileModeIfExists, mode: 0o600 },
  ])("rethrows non-ENOENT errors when normalizing $name permissions", async ({ normalize, mode }) => {
    const filePath = join(tempDir, "plain-file");
    await writeFile(filePath, "not a directory", "utf8");

    await expect(normalize(join(filePath, "child"), mode)).rejects.toMatchObject({
      code: "ENOTDIR",
    });
  });

  test("matches error codes only on Error instances", () => {
    expect(hasErrorCode(Object.assign(new Error("exists"), { code: "EEXIST" }), "EEXIST")).toBe(true);
    expect(hasErrorCode(Object.assign(new Error("exists"), { code: "EEXIST" }), "ENOENT")).toBe(false);
    expect(hasErrorCode({ code: "EEXIST" }, "EEXIST")).toBe(false);
  });

  test("detects ENOENT errors", () => {
    expect(isFileNotFoundError(Object.assign(new Error("missing"), { code: "ENOENT" }))).toBe(true);
    expect(isFileNotFoundError(new Error("other"))).toBe(false);
    expect(isFileNotFoundError("ENOENT")).toBe(false);
  });
});
