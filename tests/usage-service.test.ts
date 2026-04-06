import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { getAccountAuthPath, getCodexAuthPath } from "../src/lib/paths.js";
import { fetchUsage, fetchUsageForAll } from "../src/services/usage-service.js";
import type { AccountRecord } from "../src/types.js";
import { saveState } from "../src/state/store.js";
import { withTempHome } from "./helpers/home.js";

function createAccount(email: string, accountId: string, profileId = email): AccountRecord {
  return {
    profileId,
    email,
    accountId,
    authPath: getAccountAuthPath(profileId),
    createdAt: "2026-04-04T00:00:00.000Z",
    lastUsedAt: "2026-04-04T00:00:00.000Z",
  };
}

async function writeAuthFile(authPath: string, accessToken: string, accountId = "acct"): Promise<void> {
  await mkdir(dirname(authPath), { recursive: true });
  await writeFile(authPath, JSON.stringify({
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    last_refresh: "2026-04-04T00:00:00.000Z",
    tokens: {
      access_token: accessToken,
      account_id: accountId,
    },
  }), "utf8");
}

describe("usage service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("returns a typed failure when auth is missing", async () => {
    await withTempHome(async () => {
      const result = await fetchUsage(createAccount("missing@example.com", "acct-missing"));

      expect(result).toEqual({
        email: "missing@example.com",
        ok: false,
        code: "auth_missing",
        error: "Saved auth file not found.",
      });
    });
  });

  test("fails closed when a stored auth file belongs to a different account", async () => {
    await withTempHome(async () => {
      const account = createAccount("mismatch@example.com", "acct-expected");
      await writeAuthFile(account.authPath, "token-mismatch", "acct-other");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const result = await fetchUsage(account);

      expect(result).toEqual({
        email: "mismatch@example.com",
        ok: false,
        code: "auth_mismatch",
        error: "Saved auth does not match the requested account.",
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.ok && JSON.stringify(result)).not.toContain(account.authPath);
    });
  });

  test("fails closed when the current active auth belongs to a different account", async () => {
    await withTempHome(async () => {
      const currentAccount = createAccount("current@example.com", "acct-current", "profile-current");
      await saveState({
        currentProfileId: "profile-current",
        accounts: {
          "profile-current": currentAccount,
        },
      });
      await writeAuthFile(getCodexAuthPath(), "token-current", "acct-other");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const result = await fetchUsage(currentAccount);

      expect(result).toEqual({
        email: "current@example.com",
        ok: false,
        code: "auth_mismatch",
        error: "Saved auth does not match the requested account.",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  test("prefers the freshest active auth for the current account", async () => {
    await withTempHome(async (homeDir) => {
      const authPath = getCodexAuthPath();
      const currentAccount = {
        ...createAccount("current@example.com", "acct-current", "profile-current"),
        profileId: "profile-current",
      };

      await writeAuthFile(authPath, "token-current-active", "acct-current");
      await writeAuthFile(currentAccount.authPath, "token-current-stored", "acct-current");
      await saveState({
        currentProfileId: "profile-current",
        accounts: {
          "profile-current": currentAccount,
        },
      });

      let observedAuthorization: string | null = null;
      vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
        observedAuthorization = new Headers(init?.headers).get("Authorization");
        return new Response(JSON.stringify({
          plan_type: "pro",
          rate_limit: {
            primary_window: {
              used_percent: 42,
              reset_at: 1_775_300_000,
            },
            secondary_window: {
              used_percent: 7,
              reset_at: 1_775_400_000,
            },
          },
        }), { status: 200 });
      }));

      const result = await fetchUsage(currentAccount);

      expect(result.ok).toBe(true);
      expect(observedAuthorization).toBe("Bearer token-current-active");
    });
  });

  test("returns malformed_response when the payload is missing required fields", async () => {
    await withTempHome(async () => {
      const account = createAccount("payload@example.com", "acct-payload");
      await writeAuthFile(account.authPath, "token-payload", "acct-payload");

      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
        plan_type: "pro",
      }), { status: 200 })));

      const result = await fetchUsage(account);

      expect(result).toEqual({
        email: "payload@example.com",
        ok: false,
        code: "malformed_response",
        error: expect.stringContaining("missing rate_limit"),
      });
    });
  });

  test("returns malformed_response when the endpoint returns invalid JSON with a non-Error failure", async () => {
    await withTempHome(async () => {
      const account = createAccount("invalid-json@example.com", "acct-invalid-json");
      await writeAuthFile(account.authPath, "token-invalid-json", "acct-invalid-json");

      vi.stubGlobal("fetch", vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => Promise.reject("bad json"),
      } satisfies Partial<Response> as Response)));

      const result = await fetchUsage(account);

      expect(result).toEqual({
        email: "invalid-json@example.com",
        ok: false,
        code: "malformed_response",
        error: "Usage endpoint returned invalid JSON.",
      });
    });
  });

  test("tolerates unknown fields in a successful response", async () => {
    await withTempHome(async () => {
      const account = createAccount("extra@example.com", "acct-extra");
      await writeAuthFile(account.authPath, "token-extra", "acct-extra");

      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
        plan_type: "pro",
        extra_field: "ignored",
        rate_limit: {
          primary_window: {
            used_percent: 24,
            reset_at: 1_775_300_000,
            extra_nested: true,
          },
          secondary_window: {
            used_percent: 11,
            reset_at: 1_775_400_000,
          },
        },
      }), { status: 200 })));

      const result = await fetchUsage(account);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("Expected success result.");
      }

      expect(result.snapshot).toMatchObject({
        email: "extra@example.com",
        observedEmail: null,
        planType: "pro",
        primaryWindow: {
          usedPercent: 24,
        },
        secondaryWindow: {
          usedPercent: 11,
        },
        secondaryWindowIssue: null,
      });
    });
  });

  test("treats a malformed secondary window as an unavailable weekly limit", async () => {
    await withTempHome(async () => {
      const account = createAccount("expired@example.com", "acct-expired");
      await writeAuthFile(account.authPath, "token-expired", "acct-expired");

      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
        plan_type: "pro",
        rate_limit: {
          primary_window: {
            used_percent: 24,
            reset_at: 1_775_300_000,
          },
          secondary_window: null,
        },
      }), { status: 200 })));

      const result = await fetchUsage(account);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("Expected success result.");
      }

      expect(result.snapshot).toMatchObject({
        email: "expired@example.com",
        planType: "pro",
        primaryWindow: {
          usedPercent: 24,
        },
        secondaryWindow: null,
        secondaryWindowIssue: "malformed",
      });
    });
  });

  test("preserves the observed email returned by the usage endpoint", async () => {
    await withTempHome(async () => {
      const account = createAccount("label@example.com", "acct-extra");
      await writeAuthFile(account.authPath, "token-extra", "acct-extra");

      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
        email: "admin@northview.jp",
        plan_type: "pro",
        rate_limit: {
          primary_window: {
            used_percent: 24,
            reset_at: 1_775_300_000,
          },
        },
      }), { status: 200 })));

      const result = await fetchUsage(account);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("Expected success result.");
      }

      expect(result.snapshot.observedEmail).toBe("admin@northview.jp");
    });
  });

  test("returns rate_limited when the usage endpoint responds with HTTP 429", async () => {
    await withTempHome(async () => {
      const account = createAccount("limited@example.com", "acct-rate-limited");
      await writeAuthFile(account.authPath, "token-rate-limited", "acct-rate-limited");

      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));

      const result = await fetchUsage(account);

      expect(result).toEqual({
        email: "limited@example.com",
        ok: false,
        code: "rate_limited",
        error: expect.stringContaining("HTTP 429"),
      });
    });
  });

  test("returns network_error when fetch rejects with a non-Error value", async () => {
    await withTempHome(async () => {
      const account = createAccount("network@example.com", "acct-network");
      await writeAuthFile(account.authPath, "token-network", "acct-network");

      vi.stubGlobal("fetch", vi.fn(async () => Promise.reject("network down")));

      const result = await fetchUsage(account);

      expect(result).toEqual({
        email: "network@example.com",
        ok: false,
        code: "network_error",
        error: "Failed to reach usage endpoint.",
      });
    });
  });

  test("returns auth_invalid when the current account resolves to an unsupported credential store", async () => {
    await withTempHome(async (homeDir) => {
      const currentAccount = {
        ...createAccount("current@example.com", "acct-current", "profile-current"),
        profileId: "profile-current",
      };

      await writeAuthFile(currentAccount.authPath, "token-current-stored", "acct-current");
      await mkdir(dirname(getCodexAuthPath()), { recursive: true });
      await writeFile(join(homeDir, ".codex", "config.toml"), 'cli_auth_credentials_store = "keyring"\n', "utf8");
      await saveState({
        currentProfileId: "profile-current",
        accounts: {
          "profile-current": currentAccount,
        },
      });

      const result = await fetchUsage(currentAccount);

      expect(result).toEqual({
        email: "current@example.com",
        ok: false,
        code: "auth_invalid",
        error: expect.stringContaining("file-based Codex auth storage"),
      });
    });
  });

  test("keeps using stored auth for non-current accounts even when the active store is unsupported", async () => {
    await withTempHome(async (homeDir) => {
      const account = createAccount("stored@example.com", "acct-stored", "profile-stored");
      await writeAuthFile(account.authPath, "token-stored", "acct-stored");
      await mkdir(join(homeDir, ".codex"), { recursive: true });
      await writeFile(join(homeDir, ".codex", "config.toml"), 'cli_auth_credentials_store = "keyring"\n', "utf8");
      await saveState({
        currentProfileId: "someone-else",
        accounts: {
          "someone-else": {
            ...createAccount("other@example.com", "acct-other", "someone-else"),
            profileId: "someone-else",
          },
          [account.profileId]: account,
        },
      });

      let observedAuthorization: string | null = null;
      vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
        observedAuthorization = new Headers(init?.headers).get("Authorization");
        return new Response(JSON.stringify({
          plan_type: "pro",
          rate_limit: {
            primary_window: {
              used_percent: 5,
              reset_at: 1_775_300_000,
            },
            secondary_window: {
              used_percent: 1,
              reset_at: 1_775_400_000,
            },
          },
        }), { status: 200 });
      }));

      const result = await fetchUsage(account);

      expect(result.ok).toBe(true);
      expect(observedAuthorization).toBe("Bearer token-stored");
    });
  });

  test("returns bad_request when the usage endpoint responds with HTTP 400", async () => {
    await withTempHome(async () => {
      const account = createAccount("bad@example.com", "acct-bad-request");
      await writeAuthFile(account.authPath, "token-bad-request", "acct-bad-request");

      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 400 })));

      const result = await fetchUsage(account);

      expect(result).toEqual({
        email: "bad@example.com",
        ok: false,
        code: "bad_request",
        error: expect.stringContaining("HTTP 400"),
      });
    });
  });

  test("returns endpoint_missing when the usage endpoint responds with HTTP 404 or 410", async () => {
    await withTempHome(async () => {
      const missingAccount = createAccount("missing@example.com", "acct-missing");
      const goneAccount = createAccount("gone@example.com", "acct-gone");
      await Promise.all([
        writeAuthFile(missingAccount.authPath, "token-missing", "acct-missing"),
        writeAuthFile(goneAccount.authPath, "token-gone", "acct-gone"),
      ]);

      vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string> | undefined;
        const token = headers?.Authorization?.replace("Bearer ", "");
        return new Response("{}", { status: token === "token-missing" ? 404 : 410 });
      }));

      const missing = await fetchUsage(missingAccount);

      expect(missing).toEqual({
        email: "missing@example.com",
        ok: false,
        code: "endpoint_missing",
        error: expect.stringContaining("HTTP 404"),
      });

      const gone = await fetchUsage(goneAccount);

      expect(gone).toEqual({
        email: "gone@example.com",
        ok: false,
        code: "endpoint_missing",
        error: expect.stringContaining("HTTP 410"),
      });
    });
  });

  test("returns unsupported_method when the usage endpoint responds with HTTP 405", async () => {
    await withTempHome(async () => {
      const account = createAccount("method@example.com", "acct-method");
      await writeAuthFile(account.authPath, "token-method", "acct-method");

      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 405 })));

      const result = await fetchUsage(account);

      expect(result).toEqual({
        email: "method@example.com",
        ok: false,
        code: "unsupported_method",
        error: expect.stringContaining("HTTP 405"),
      });
    });
  });

  test("returns invalid_response_contract when the usage endpoint responds with HTTP 422", async () => {
    await withTempHome(async () => {
      const account = createAccount("contract@example.com", "acct-contract");
      await writeAuthFile(account.authPath, "token-contract", "acct-contract");

      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 422 })));

      const result = await fetchUsage(account);

      expect(result).toEqual({
        email: "contract@example.com",
        ok: false,
        code: "invalid_response_contract",
        error: expect.stringContaining("HTTP 422"),
      });
    });
  });

  test("returns endpoint_changed for unexpected 4xx responses", async () => {
    await withTempHome(async () => {
      const account = createAccount("unexpected@example.com", "acct-unexpected");
      await writeAuthFile(account.authPath, "token-unexpected", "acct-unexpected");

      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 418 })));

      const result = await fetchUsage(account);

      expect(result).toEqual({
        email: "unexpected@example.com",
        ok: false,
        code: "endpoint_changed",
        error: expect.stringContaining("HTTP 418"),
      });
    });
  });

  test("returns service_unavailable when the usage endpoint responds with HTTP 503", async () => {
    await withTempHome(async () => {
      const account = createAccount("service@example.com", "acct-service-unavailable");
      await writeAuthFile(account.authPath, "token-service-unavailable", "acct-service-unavailable");

      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));

      const result = await fetchUsage(account);

      expect(result).toEqual({
        email: "service@example.com",
        ok: false,
        code: "service_unavailable",
        error: expect.stringContaining("HTTP 503"),
      });
    });
  });

  test("keeps stable email ordering and partial failures for usage --all", async () => {
    await withTempHome(async () => {
      const accounts = [
        createAccount("charlie@example.com", "acct-c", "profile-c"),
        createAccount("alpha@example.com", "acct-a", "profile-a"),
        createAccount("bravo@example.com", "acct-b", "profile-b"),
      ];

      await Promise.all([
        writeAuthFile(accounts[0].authPath, "token-c", "acct-c"),
        writeAuthFile(accounts[1].authPath, "token-a", "acct-a"),
        writeAuthFile(accounts[2].authPath, "token-b", "acct-b"),
      ]);

      vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
        const authHeader = init?.headers && "Authorization" in init.headers
          ? init.headers.Authorization
          : (init?.headers as Record<string, string> | undefined)?.Authorization;
        const token = authHeader?.replace("Bearer ", "");

        if (token === "token-a") {
          return new Response(JSON.stringify({
            plan_type: "pro",
            rate_limit: {
              primary_window: {
                used_percent: 42,
                reset_at: 1_775_300_000,
              },
              secondary_window: {
                used_percent: 7,
                reset_at: 1_775_400_000,
              },
            },
          }), { status: 200 });
        }

        if (token === "token-b") {
          return new Response("{}", { status: 401 });
        }

        return new Response(JSON.stringify({
          plan_type: "plus",
          rate_limit: {
            primary_window: {
              used_percent: 13,
              reset_at: 1_775_500_000,
            },
            secondary_window: {
              used_percent: 2,
              reset_at: 1_775_600_000,
            },
          },
        }), { status: 200 });
      }));

      const results = await fetchUsageForAll(accounts);

      expect(results.map((result) => result.email)).toEqual([
        "alpha@example.com",
        "bravo@example.com",
        "charlie@example.com",
      ]);

      expect(results[0]).toMatchObject({
        email: "alpha@example.com",
        ok: true,
        snapshot: {
          planType: "pro",
        },
      });

      expect(results[1]).toMatchObject({
        email: "bravo@example.com",
        ok: false,
        code: "unauthorized",
      });

      expect(results[2]).toMatchObject({
        email: "charlie@example.com",
        ok: true,
        snapshot: {
          planType: "plus",
        },
      });
    });
  });

  test("reports progress as usage --all completes", async () => {
    await withTempHome(async () => {
      const accounts = [
        createAccount("bravo@example.com", "acct-b", "profile-b"),
        createAccount("alpha@example.com", "acct-a", "profile-a"),
      ];

      await Promise.all([
        writeAuthFile(accounts[0].authPath, "token-b", "acct-b"),
        writeAuthFile(accounts[1].authPath, "token-a", "acct-a"),
      ]);

      vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string> | undefined;
        const token = headers?.Authorization?.replace("Bearer ", "");

        if (token === "token-b") {
          return new Response("{}", { status: 401 });
        }

        return new Response(JSON.stringify({
          plan_type: "pro",
          rate_limit: {
            primary_window: {
              used_percent: 18,
              reset_at: 1_775_300_000,
            },
            secondary_window: {
              used_percent: 4,
              reset_at: 1_775_400_000,
            },
          },
        }), { status: 200 });
      }));

      const progressEvents: Array<{ completed: number; failed: number; email: string; ok: boolean }> = [];

      await fetchUsageForAll(accounts, {
        onProgress: (progress) => {
          progressEvents.push({
            completed: progress.completed,
            failed: progress.failed,
            email: progress.email,
            ok: progress.ok,
          });
        },
      });

      expect(progressEvents).toHaveLength(2);
      expect(progressEvents[0]).toMatchObject({
        completed: 1,
      });
      expect(progressEvents[1]).toMatchObject({
        completed: 2,
        failed: 1,
      });

      const sortedByEmail = [...progressEvents].sort((left, right) => left.email.localeCompare(right.email));
      expect(sortedByEmail).toEqual([
        {
          completed: expect.any(Number),
          failed: expect.any(Number),
          email: "alpha@example.com",
          ok: true,
        },
        {
          completed: expect.any(Number),
          failed: expect.any(Number),
          email: "bravo@example.com",
          ok: false,
        },
      ]);
    });
  });

  test("repairs managed auth file permissions before reading a stored account", async () => {
    await withTempHome(async () => {
      const account = createAccount("repair@example.com", "acct-repair");
      await writeAuthFile(account.authPath, "token-repair", "acct-repair");
      await chmod(account.authPath, 0o644);
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
        plan_type: "pro",
        rate_limit: {
          primary_window: {
            used_percent: 18,
            reset_at: 1_775_300_000,
          },
          secondary_window: {
            used_percent: 4,
            reset_at: 1_775_400_000,
          },
        },
      }), { status: 200 })));

      const result = await fetchUsage(account);

      expect(result.ok).toBe(true);
      expect((await stat(account.authPath)).mode & 0o777).toBe(0o600);
    });
  });

  test("marks every account as failed when every fetch fails", async () => {
    await withTempHome(async () => {
      const accounts = [
        createAccount("alpha@example.com", "acct-alpha", "profile-alpha"),
        createAccount("bravo@example.com", "acct-bravo", "profile-bravo"),
      ];

      const results = await fetchUsageForAll(accounts);

      expect(results).toHaveLength(2);
      expect(results.every((result) => !result.ok)).toBe(true);
      expect(results.map((result) => result.email)).toEqual([
        "alpha@example.com",
        "bravo@example.com",
      ]);
    });
  });

});
