import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { getConfigDir } from "../src/lib/paths.js";
import { withTempHome } from "./helpers/home.js";

describe("managed storage permissions", () => {
  afterEach(() => {
    vi.resetModules();
  });

  test("retries after a failed attempt instead of caching the failure", async () => {
    // Fresh module instance so the permission cache starts empty.
    const { ensureManagedStoragePermissions } = await import("../src/lib/managed-storage.js");

    await withTempHome(async () => {
      const configDir = getConfigDir();
      await mkdir(dirname(configDir), { recursive: true });
      await writeFile(configDir, "not a directory", "utf8");

      await expect(ensureManagedStoragePermissions()).rejects.toMatchObject({ code: "EEXIST" });

      await rm(configDir);
      await expect(ensureManagedStoragePermissions()).resolves.toBeUndefined();
      expect((await stat(configDir)).mode & 0o777).toBe(0o700);
    });
  });
});
