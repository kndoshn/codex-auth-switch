import { afterEach, describe, expect, test, vi } from "vitest";

import { UsageFetchError } from "../src/lib/errors.js";
import { requestUsagePayload } from "../src/services/usage-endpoint.js";

describe("usage-endpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("wraps Error network failures with the original message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("socket hang up");
    }));

    await expect(requestUsagePayload("token")).rejects.toMatchObject<Partial<UsageFetchError>>({
      code: "network_error",
      message: "socket hang up",
    });
  });

  test("wraps non-Error network failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw "network down";
    }));

    await expect(requestUsagePayload("token")).rejects.toMatchObject<Partial<UsageFetchError>>({
      code: "network_error",
      message: "Failed to reach usage endpoint.",
    });
  });

  test("wraps non-Error JSON failures as malformed_response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => Promise.reject("bad json"),
    }) satisfies Partial<Response> as Response));

    await expect(requestUsagePayload("token")).rejects.toMatchObject<Partial<UsageFetchError>>({
      code: "malformed_response",
      message: "Usage endpoint returned invalid JSON.",
    });
  });

  test("wraps Error JSON failures with the parser message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => Promise.reject(new Error("unexpected end of json input")),
    }) satisfies Partial<Response> as Response));

    await expect(requestUsagePayload("token")).rejects.toMatchObject<Partial<UsageFetchError>>({
      code: "malformed_response",
      message: "unexpected end of json input",
    });
  });
});
