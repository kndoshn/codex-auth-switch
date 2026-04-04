import { describe, expect, test } from "vitest";
import { execa } from "execa";

import { withTempHome } from "./helpers/home.js";

describe("CLI integration", () => {
  test("lists an empty state", async () => {
    await withTempHome(async (homeDir) => {
      const result = await execa(process.execPath, ["--import", "tsx", "src/index.ts", "ls"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: homeDir,
        },
        reject: false,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No saved accounts yet.");
      expect(result.stdout).toContain("./codex-auth-switch add <email>");
    });
  });

  test("returns exit code 1 for invalid add email", async () => {
    await withTempHome(async (homeDir) => {
      const result = await execa(process.execPath, ["--import", "tsx", "src/index.ts", "add", "invalid"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: homeDir,
        },
        reject: false,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Please provide a valid email address.");
    });
  });

  test("documents that add treats email as a label", async () => {
    await withTempHome(async (homeDir) => {
      const result = await execa(process.execPath, ["--import", "tsx", "src/index.ts", "add", "--help"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: homeDir,
        },
        reject: false,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("user-supplied email label");
      expect(result.stdout).toContain("not verified against the sign-in session");
      expect(result.stdout).toContain("email label");
    });
  });

  test("returns exit code 1 when usage has no current account", async () => {
    await withTempHome(async (homeDir) => {
      const result = await execa(process.execPath, ["--import", "tsx", "src/index.ts", "usage"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: homeDir,
        },
        reject: false,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("No active account label is selected.");
    });
  });
});
