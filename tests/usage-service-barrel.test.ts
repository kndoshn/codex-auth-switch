import { describe, expect, test } from "vitest";

import * as usageAggregation from "../src/services/usage-aggregation.js";
import * as usageConcurrency from "../src/services/usage-concurrency.js";
import * as usageFetch from "../src/services/usage-fetch.js";
import * as usageService from "../src/services/usage-service.js";

describe("usage-service barrel", () => {
  test("re-exports usage helpers", () => {
    expect(usageService.fetchUsage).toBe(usageFetch.fetchUsage);
    expect(usageService.fetchUsageForAll).toBe(usageAggregation.fetchUsageForAll);
    expect(usageService.mapWithConcurrency).toBe(usageConcurrency.mapWithConcurrency);
  });
});
