import type { UsageFailureCode, UsageResult, UsageSnapshot, UsageWindow } from "../types.js";
import { UsageFetchError } from "./errors.js";

export function toUsageSnapshot(raw: unknown, email: string): UsageSnapshot {
  if (!isRecord(raw)) {
    throw new UsageFetchError("malformed_response", "Usage endpoint returned a non-object payload.");
  }

  const rateLimit = raw.rate_limit;
  if (!isRecord(rateLimit)) {
    throw new UsageFetchError("malformed_response", "Usage endpoint payload is missing rate_limit.");
  }

  const primaryWindow = toUsageWindow(rateLimit.primary_window);
  const secondaryWindow = toUsageWindow(rateLimit.secondary_window);

  if (rateLimit.primary_window !== undefined && primaryWindow === null) {
    throw new UsageFetchError("malformed_response", "Usage endpoint primary window is malformed.");
  }

  if (rateLimit.secondary_window !== undefined && secondaryWindow === null) {
    throw new UsageFetchError("malformed_response", "Usage endpoint secondary window is malformed.");
  }

  return {
    email,
    observedEmail: normalizeObservedEmail(raw.email),
    planType: typeof raw.plan_type === "string" ? raw.plan_type : null,
    primaryWindow,
    secondaryWindow,
    fetchedAt: new Date().toISOString(),
  };
}

export function toUsageFailure(error: unknown): { code: UsageFailureCode; message: string } {
  if (error instanceof UsageFetchError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      code: "network_error",
      message: error.message,
    };
  }

  return {
    code: "network_error",
    message: "Unknown usage failure.",
  };
}

export function allUsageResultsFailed(results: readonly UsageResult[]): boolean {
  return results.length > 0 && results.every((result) => !result.ok);
}

function toUsageWindow(raw: unknown): UsageWindow | null {
  if (!isRecord(raw)) {
    return null;
  }

  const usedPercent = raw.used_percent;
  const resetAt = raw.reset_at;
  const windowMinutes = resolveWindowMinutes(raw);

  if (typeof usedPercent !== "number" || typeof resetAt !== "number") {
    return null;
  }

  return {
    usedPercent,
    resetAt: new Date(resetAt * 1000).toISOString(),
    windowMinutes,
  };
}

function resolveWindowMinutes(raw: Record<string, unknown>): number | null {
  if (typeof raw.window_minutes === "number") {
    return raw.window_minutes;
  }

  if (typeof raw.limit_window_minutes === "number") {
    return raw.limit_window_minutes;
  }

  if (typeof raw.limit_window_seconds === "number") {
    return raw.limit_window_seconds / 60;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeObservedEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}
