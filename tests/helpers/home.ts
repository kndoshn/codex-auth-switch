import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function withTempHome<T>(run: (homeDir: string) => Promise<T>): Promise<T> {
  const homeDir = await mkdtemp(join(tmpdir(), "codex-auth-switch-test-home-"));
  const previousHome = process.env.HOME;
  const previousCodexHome = process.env.CODEX_HOME;

  process.env.HOME = homeDir;
  delete process.env.CODEX_HOME;

  try {
    return await run(homeDir);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }

    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }

    await rm(homeDir, { force: true, recursive: true });
  }
}
