import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { randomUUID } from "node:crypto";

const STALE_TMP_FILE_AGE_MS = 60 * 60 * 1000;

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

export async function ensureDirectoryModeIfExists(path: string, mode: number): Promise<void> {
  try {
    const stats = await stat(path);
    if (!stats.isDirectory()) {
      return;
    }

    if ((stats.mode & 0o777) !== mode) {
      await chmod(path, mode);
    }
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
  }
}

export async function ensureFileModeIfExists(path: string, mode: number): Promise<void> {
  try {
    const stats = await stat(path);
    if (!stats.isFile()) {
      return;
    }

    if ((stats.mode & 0o777) !== mode) {
      await chmod(path, mode);
    }
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
  }
}

export async function readFileIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const parentDir = dirname(path);
  await ensureDirectory(parentDir);
  await cleanupStaleTmpFiles(path);

  const tmpPath = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;

  try {
    await writeFile(tmpPath, content, { encoding: "utf8", mode: 0o600 });
    await rename(tmpPath, path);
    await chmod(path, 0o600);
  } finally {
    await rm(tmpPath, { force: true });
  }
}

async function cleanupStaleTmpFiles(path: string): Promise<void> {
  const parentDir = dirname(path);
  const targetName = basename(path);

  let entries: string[];
  try {
    entries = await readdir(parentDir);
  } catch {
    return;
  }

  await Promise.all(entries.map(async (entry) => {
    if (!entry.startsWith(`${targetName}.`) || !entry.endsWith(".tmp")) {
      return;
    }

    const entryPath = `${parentDir}/${entry}`;

    try {
      const entryStat = await stat(entryPath);
      if (Date.now() - entryStat.mtimeMs < STALE_TMP_FILE_AGE_MS) {
        return;
      }
    } catch {
      return;
    }

    await rm(entryPath, { force: true });
  }));
}

export function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
