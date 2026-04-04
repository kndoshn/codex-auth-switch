import { describe, expect, test } from "vitest";

import { mapUsageHttpFailure } from "../src/lib/usage-http.js";

describe("usage http failure mapping", () => {
  test.each([
    [400, "bad_request", "usage.http.bad_request"],
    [404, "endpoint_missing", "usage.http.endpoint_missing"],
    [410, "endpoint_missing", "usage.http.endpoint_missing"],
    [405, "unsupported_method", "usage.http.unsupported_method"],
    [409, "invalid_response_contract", "usage.http.invalid_response_contract"],
    [415, "invalid_response_contract", "usage.http.invalid_response_contract"],
    [422, "invalid_response_contract", "usage.http.invalid_response_contract"],
    [429, "rate_limited", "usage.http.rate_limited"],
    [500, "service_unavailable", "usage.http.service_unavailable"],
    [503, "service_unavailable", "usage.http.service_unavailable"],
    [418, "endpoint_changed", "usage.http.endpoint_changed"],
  ])("maps HTTP %i to %s", (status, code, event) => {
    expect(mapUsageHttpFailure(status)).toMatchObject({
      code,
      event,
    });
  });
});
