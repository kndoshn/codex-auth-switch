import type { AccountRecord, UsageResult } from "../types.js";
import { sortAccountsByEmail } from "../lib/accounts.js";
import { logDebug } from "../lib/log.js";
import { mapWithConcurrency } from "./usage-concurrency.js";
import { createUsageFetchContext, fetchUsage } from "./usage-fetch.js";

const DEFAULT_CONCURRENCY = 4;

export type UsageFetchProgress = {
  total: number;
  completed: number;
  failed: number;
  email: string;
  ok: boolean;
};

export type UsageAggregationOptions = {
  concurrency?: number;
  onProgress?: (progress: UsageFetchProgress) => void;
};

export async function fetchUsageForAll(
  accounts: AccountRecord[],
  options: UsageAggregationOptions = {},
): Promise<UsageResult[]> {
  const sortedAccounts = sortAccountsByEmail(accounts);
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  let completed = 0;
  let failed = 0;

  logDebug("usage.fetch_all.start", "Fetching usage for all accounts.", {
    accountCount: sortedAccounts.length,
    concurrency,
  });
  const context = await createUsageFetchContext(...sortedAccounts);

  const results = await mapWithConcurrency(
    sortedAccounts,
    concurrency,
    async (account) => {
      const result = await fetchUsage(account, context);
      completed += 1;
      if (!result.ok) {
        failed += 1;
      }

      options.onProgress?.({
        total: sortedAccounts.length,
        completed,
        failed,
        email: account.email,
        ok: result.ok,
      });

      return result;
    },
  );

  logDebug("usage.fetch_all.success", "Fetched usage for all accounts.", {
    accountCount: results.length,
    failedCount: results.filter((result) => !result.ok).length,
  });
  return results;
}
