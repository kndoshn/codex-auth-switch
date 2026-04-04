import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, test } from "vitest";

import { UnsupportedCredentialStoreError } from "../src/lib/errors.js";
import {
  requireFileBasedCodexAuthSource,
  resolveCodexAuthSource,
} from "../src/lib/codex-auth-source.js";
import { withTempHome } from "./helpers/home.js";

describe("codex auth source", () => {
  test("resolves to file mode when auth.json is readable", async () => {
    await withTempHome(async (homeDir) => {
      const authPath = join(homeDir, "auth.json");
      await mkdir(dirname(authPath), { recursive: true });
      await writeFile(authPath, JSON.stringify({
        tokens: {
          account_id: "acct-1",
          access_token: "token-1",
        },
      }), "utf8");

      await expect(resolveCodexAuthSource(homeDir)).resolves.toMatchObject({
        configuredMode: "auto",
        resolvedMode: "file",
        authPath,
        homeDir,
      });
    });
  });

  test("rejects keyring-backed storage", async () => {
    await withTempHome(async (homeDir) => {
      const configPath = join(homeDir, "config.toml");
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, 'cli_auth_credentials_store = "keyring"\n', "utf8");

      await expect(requireFileBasedCodexAuthSource(homeDir)).rejects.toBeInstanceOf(
        UnsupportedCredentialStoreError,
      );
    });
  });

  test("rejects invalid credential store settings", async () => {
    await withTempHome(async (homeDir) => {
      const configPath = join(homeDir, "config.toml");
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, 'cli_auth_credentials_store = "bogus"\n', "utf8");

      await expect(requireFileBasedCodexAuthSource(homeDir)).rejects.toBeInstanceOf(
        UnsupportedCredentialStoreError,
      );
    });
  });

  test("rejects malformed credential store settings", async () => {
    await withTempHome(async (homeDir) => {
      const configPath = join(homeDir, "config.toml");
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, "cli_auth_credentials_store = file\n", "utf8");

      await expect(requireFileBasedCodexAuthSource(homeDir)).rejects.toBeInstanceOf(
        UnsupportedCredentialStoreError,
      );
    });
  });

  test("respects an explicit file credential store setting", async () => {
    await withTempHome(async (homeDir) => {
      const authPath = join(homeDir, "auth.json");
      const configPath = join(homeDir, "config.toml");
      await mkdir(dirname(authPath), { recursive: true });
      await writeFile(authPath, JSON.stringify({
        tokens: {
          account_id: "acct-1",
          access_token: "token-1",
        },
      }), "utf8");
      await writeFile(configPath, 'cli_auth_credentials_store = "file"\n', "utf8");

      await expect(resolveCodexAuthSource(homeDir)).resolves.toMatchObject({
        configuredMode: "file",
        resolvedMode: "file",
        authPath,
      });
    });
  });

  test("rejects unresolved auto mode when no auth.json exists", async () => {
    await withTempHome(async (homeDir) => {
      await expect(requireFileBasedCodexAuthSource(homeDir)).rejects.toBeInstanceOf(
        UnsupportedCredentialStoreError,
      );
    });
  });
});
