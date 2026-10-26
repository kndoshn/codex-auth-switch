import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, test } from "vitest";

import { AuthReadError } from "../src/lib/errors.js";
import {
  extractAccountId,
  readAuthFile,
  updateAuthFileTokens,
  writeAuthFile,
} from "../src/lib/auth.js";
import { withTempHome } from "./helpers/home.js";

describe("auth helpers", () => {
  test("extracts account_id from auth payloads", () => {
    const raw = JSON.stringify({
      tokens: {
        account_id: "acct-123",
        access_token: "token-123",
      },
    });

    expect(extractAccountId(raw)).toBe("acct-123");
  });

  test.each([
    { name: "access_token is missing", tokens: { account_id: "acct-123" } },
    { name: "account_id is empty", tokens: { account_id: "", access_token: "token-123" } },
  ])("throws a typed error when $name", ({ tokens }) => {
    expect(() => extractAccountId(JSON.stringify({ tokens }))).toThrow(AuthReadError);
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
        refreshToken: "refresh-token",
        lastRefresh: "2026-04-04T10:13:54.567220Z",
      });
    });
  });

  test("updates auth token fields without dropping unrelated auth payload fields", () => {
    const raw = JSON.stringify({
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      last_refresh: "2026-04-04T10:13:54.567220Z",
      tokens: {
        id_token: "id-token-old",
        account_id: "acct-456",
        access_token: "token-456",
        refresh_token: "refresh-token-old",
      },
      extra_field: "kept",
    });

    const updated = JSON.parse(updateAuthFileTokens(raw, {
      accessToken: "token-new",
      refreshToken: "refresh-token-new",
      idToken: "id-token-new",
      lastRefresh: "2026-04-17T00:00:00.000Z",
    })) as {
      auth_mode: string;
      OPENAI_API_KEY: null;
      last_refresh: string;
      extra_field: string;
      tokens: {
        id_token: string;
        account_id: string;
        access_token: string;
        refresh_token: string;
      };
    };

    expect(updated).toEqual({
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      last_refresh: "2026-04-17T00:00:00.000Z",
      extra_field: "kept",
      tokens: {
        id_token: "id-token-new",
        account_id: "acct-456",
        access_token: "token-new",
        refresh_token: "refresh-token-new",
      },
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

  test("wraps missing auth files while keeping ENOENT as the cause", async () => {
    await withTempHome(async (homeDir) => {
      await expect(readAuthFile(join(homeDir, "missing.json"))).rejects.toMatchObject({
        name: "AuthReadError",
        cause: expect.objectContaining({ code: "ENOENT" }),
      });
    });
  });

  test("wraps auth read failures for paths that are not files", async () => {
    await withTempHome(async (homeDir) => {
      const authPath = join(homeDir, "directory-auth");
      await mkdir(authPath, { recursive: true });

      await expect(readAuthFile(authPath)).rejects.toBeInstanceOf(AuthReadError);
    });
  });

  test("rejects invalid JSON without exposing the file contents", async () => {
    await withTempHome(async (homeDir) => {
      const authPath = join(homeDir, "invalid.json");
      await writeFile(authPath, '{"tokens": {"access_token": "secret-token"', "utf8");

      const error = await readAuthFile(authPath).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AuthReadError);
      expect((error as Error).message).not.toContain("secret-token");
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
