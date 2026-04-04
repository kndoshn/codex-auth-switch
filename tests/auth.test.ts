import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, test } from "vitest";

import { AuthReadError } from "../src/lib/errors.js";
import {
  extractAccessToken,
  extractAccountId,
  readAccessTokenFile,
  readAuthFile,
  writeAuthFile,
} from "../src/lib/auth.js";
import { withTempHome } from "./helpers/home.js";

describe("auth helpers", () => {
  test("extracts account_id and access_token from auth payloads", () => {
    const raw = JSON.stringify({
      tokens: {
        account_id: "acct-123",
        access_token: "token-123",
      },
    });

    expect(extractAccountId(raw)).toBe("acct-123");
    expect(extractAccessToken(raw)).toBe("token-123");
  });

  test("throws a typed error when access_token is missing", () => {
    const raw = JSON.stringify({
      tokens: {
        account_id: "acct-123",
      },
    });

    expect(() => extractAccessToken(raw)).toThrow(AuthReadError);
  });

  test("reads access_token directly from an auth file", async () => {
    await withTempHome(async (homeDir) => {
      const authPath = join(homeDir, "accounts", "auth.json");
      await mkdir(dirname(authPath), { recursive: true });
      await writeFile(authPath, JSON.stringify({
        tokens: {
          account_id: "acct-123",
          access_token: "token-123",
        },
      }), "utf8");

      await expect(readAccessTokenFile(authPath)).resolves.toBe("token-123");
    });
  });

  test("reads account metadata and access token together from an auth file", async () => {
    await withTempHome(async (homeDir) => {
      const authPath = join(homeDir, "accounts", "auth.json");
      await mkdir(dirname(authPath), { recursive: true });
      await writeFile(authPath, JSON.stringify({
        auth_mode: "chatgpt",
        OPENAI_API_KEY: null,
        last_refresh: "2026-04-04T10:13:54.567220Z",
        tokens: {
          id_token: "id-token",
          account_id: "acct-456",
          access_token: "token-456",
          refresh_token: "refresh-token",
        },
      }), "utf8");

      await expect(readAuthFile(authPath)).resolves.toMatchObject({
        accountId: "acct-456",
        accessToken: "token-456",
      });
    });
  });

  test("rejects invalid JSON auth payloads", () => {
    expect(() => extractAccountId("{")).toThrow(AuthReadError);
  });

  test("rejects auth payloads without a tokens object", () => {
    expect(() => extractAccountId(JSON.stringify({}))).toThrow(AuthReadError);
  });

  test("rejects auth payloads whose root value is not an object", () => {
    expect(() => extractAccountId(JSON.stringify([]))).toThrow(AuthReadError);
  });

  test("rejects missing auth files when reading an access token", async () => {
    await withTempHome(async (homeDir) => {
      await expect(readAccessTokenFile(join(homeDir, "missing.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  test("wraps non-ENOENT access token read failures", async () => {
    await withTempHome(async (homeDir) => {
      const authPath = join(homeDir, "directory-auth");
      await mkdir(authPath, { recursive: true });

      await expect(readAccessTokenFile(authPath)).rejects.toBeInstanceOf(AuthReadError);
    });
  });

  test("wraps auth write failures in a typed error", async () => {
    await withTempHome(async (homeDir) => {
      const authPath = join(homeDir, "directory-auth");
      await mkdir(authPath, { recursive: true });

      await expect(writeAuthFile(authPath, "{}")).rejects.toMatchObject({
        name: "AuthWriteError",
      });
    });
  });
});
