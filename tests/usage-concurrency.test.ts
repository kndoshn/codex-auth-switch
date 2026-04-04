import { describe, expect, test } from "vitest";

import { mapWithConcurrency } from "../src/services/usage-concurrency.js";

describe("usage-concurrency helpers", () => {
  test("respects the configured concurrency limit", async () => {
    const started: number[] = [];
    let active = 0;
    let maxActive = 0;
    const releaseQueue: Array<() => void> = [];

    const promise = mapWithConcurrency([0, 1, 2, 3], 2, async (value) => {
      started.push(value);
      active += 1;
      maxActive = Math.max(maxActive, active);

      await new Promise<void>((resolve) => {
        releaseQueue.push(() => {
          active -= 1;
          resolve();
        });
      });

      return value;
    });

    await waitFor(() => started.length === 2);
    expect(maxActive).toBe(2);

    releaseQueue.shift()?.();
    releaseQueue.shift()?.();
    await waitFor(() => releaseQueue.length === 2);

    while (releaseQueue.length > 0) {
      releaseQueue.shift()?.();
    }

    await expect(promise).resolves.toEqual([0, 1, 2, 3]);
    expect(maxActive).toBe(2);
  });

  test("treats non-positive concurrency as serial execution", async () => {
    await expect(mapWithConcurrency([1, 2, 3], 0, async (value) => value * 2)).resolves.toEqual([2, 4, 6]);
  });

  test("returns an empty array for empty concurrency input", async () => {
    await expect(mapWithConcurrency([], 4, async (value: number) => value)).resolves.toEqual([]);
  });
});

async function waitFor(predicate: () => boolean, attempts = 20): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) {
      return;
    }

    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  throw new Error("Timed out waiting for the expected condition.");
}
