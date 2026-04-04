import type { AccountRecord, UsageResult, UsageWindow } from "../types.js";

export function formatAccountList(
  accounts: AccountRecord[],
  currentProfileId: string | null,
): string {
  if (accounts.length === 0) {
    return [
      "No saved accounts yet.",
      "Run `./codex-auth-switch add <email>` to register your first account.",
    ].join("\n");
  }

  const rows = accounts.map((account) => [
    account.profileId === currentProfileId ? "yes" : "",
    account.email,
    account.accountId,
    formatLocalTimestamp(account.lastUsedAt),
  ]);

  return [`Saved accounts (${accounts.length})`, "", formatTable([
    "Active",
    "Label",
    "Account ID",
    "Last used",
  ], rows)].join("\n");
}

export function formatUsageResults(results: UsageResult[]): string {
  if (results.length === 0) {
    return "No usage data.";
  }

  const header = results.length === 1
    ? "Usage"
    : `Usage summary (${results.length} accounts)`;

  return [header, "", results.map(formatUsageBlock).join("\n\n")].join("\n");
}

export function formatAccountActionResult(
  title: "Added account" | "Active account",
  account: AccountRecord,
): string {
  return [title, "", ...formatKeyValueLines([
    ["Label", account.email],
    ["Account ID", account.accountId],
  ])].join("\n");
}

function formatUsageBlock(result: UsageResult): string {
  if (!result.ok) {
    return [
      result.email,
      ...formatKeyValueLines([
        ["Status", "error"],
        ["Code", result.code],
        ["Detail", result.error],
      ]),
    ].join("\n");
  }

  return [
    result.email,
    ...formatKeyValueLines([
      ["Status", "ok"],
      ...formatObservedEmailLines(result.email, result.snapshot.observedEmail),
      ["Plan", result.snapshot.planType ?? "unknown"],
      [formatUsageWindowLabel(result.snapshot.primaryWindow, 300), formatUsageWindow(
        result.snapshot.primaryWindow,
        result.snapshot.fetchedAt,
      )],
      [formatUsageWindowLabel(result.snapshot.secondaryWindow, 10_080), formatUsageWindow(
        result.snapshot.secondaryWindow,
        result.snapshot.fetchedAt,
      )],
      ["Fetched", formatLocalTimestamp(result.snapshot.fetchedAt)],
    ]),
  ].join("\n");
}

function formatUsageWindow(window: UsageWindow | null, anchorTimestamp: string): string {
  if (!window) {
    return "n/a";
  }

  if (window.usedPercent !== null && window.usedPercent !== undefined) {
    const summary = `${formatRemainingPercent(window.usedPercent)}% left`;
    if (window.resetAt) {
      return `${summary} (resets ${formatUsageResetTimestamp(window.resetAt, anchorTimestamp)})`;
    }

    return summary;
  }

  return window.resetAt
    ? `resets ${formatUsageResetTimestamp(window.resetAt, anchorTimestamp)}`
    : "n/a";
}

function formatUsageWindowLabel(window: UsageWindow | null, fallbackWindowMinutes: number): string {
  const duration = formatUsageWindowDuration(window?.windowMinutes ?? fallbackWindowMinutes);
  return `${capitalizeFirst(duration)} limit`;
}

function formatKeyValueLines(entries: [string, string][]): string[] {
  const keyWidth = Math.max(...entries.map(([key]) => key.length));
  return entries.map(([key, value]) => `  ${key.padEnd(keyWidth)} : ${value}`);
}

function formatObservedEmailLines(label: string, observedEmail: string | null): [string, string][] {
  if (!observedEmail || observedEmail === label) {
    return [];
  }

  return [["Observed email", observedEmail]];
}

function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(
      header.length,
      ...rows.map((row) => (row[index] ?? "").length),
    ));

  const renderRow = (cells: string[]): string =>
    cells
      .map((cell, index) => (cell ?? "").padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();

  const separator = widths.map((width) => "-".repeat(width)).join("  ");
  return [renderRow(headers), separator, ...rows.map(renderRow)].join("\n");
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute} UTC`;
}

function formatLocalTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute} local`;
}

function formatRemainingPercent(usedPercent: number): number {
  return Math.round(Math.min(100, Math.max(0, 100 - usedPercent)));
}

function formatUsageResetTimestamp(value: string, anchorTimestamp: string): string {
  const resetAt = new Date(value);
  const anchor = new Date(anchorTimestamp);

  if (Number.isNaN(resetAt.getTime()) || Number.isNaN(anchor.getTime())) {
    return value;
  }

  const time = `${String(resetAt.getHours()).padStart(2, "0")}:${String(resetAt.getMinutes()).padStart(2, "0")}`;

  if (isSameLocalDay(resetAt, anchor)) {
    return time;
  }

  const month = resetAt.toLocaleString("en-US", { month: "short" });
  return `${time} on ${resetAt.getDate()} ${month}`;
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function formatUsageWindowDuration(windowMinutes: number): string {
  const minutesPerHour = 60;
  const minutesPerDay = 24 * minutesPerHour;
  const minutesPerWeek = 7 * minutesPerDay;
  const minutesPerMonth = 30 * minutesPerDay;
  const roundingBiasMinutes = 3;
  const normalizedMinutes = Math.max(0, windowMinutes);

  if (normalizedMinutes <= minutesPerDay + roundingBiasMinutes) {
    const hours = Math.max(1, Math.floor((normalizedMinutes + roundingBiasMinutes) / minutesPerHour));
    return `${hours}h`;
  }

  if (normalizedMinutes <= minutesPerWeek + roundingBiasMinutes) {
    return "weekly";
  }

  if (normalizedMinutes <= minutesPerMonth + roundingBiasMinutes) {
    return "monthly";
  }

  return "annual";
}

function capitalizeFirst(value: string): string {
  const [first, ...rest] = value;
  if (!first) {
    return value;
  }

  return first.toUpperCase() + rest.join("");
}
