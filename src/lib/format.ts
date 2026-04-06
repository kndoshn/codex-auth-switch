import type { AccountRecord, UsageResult, UsageWindow, UsageWindowIssueCode } from "../types.js";

const USAGE_METER_WIDTH = 20;
const USAGE_METER_FILLED = "█";
const USAGE_METER_EMPTY = "░";

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
    account.profileId === currentProfileId ? "[Current]" : "",
    account.email,
    account.accountId,
    formatLocalTimestamp(account.lastUsedAt),
  ]);

  return [
    `Saved accounts (${accounts.length})`,
    "",
    formatTable(["", "Email", "Account ID", "Last used"], rows),
    "",
    "Tip: Run `use <email>` to switch accounts.",
  ].join("\n");
}

export function formatUsageResults(
  results: UsageResult[],
  options?: { currentEmail?: string; showTip?: boolean },
): string {
  if (results.length === 0) {
    return "No usage data.";
  }

  const currentEmail = options?.currentEmail ?? null;
  const firstResult = results[0];
  const header = results.length === 1
    ? `Usage — ${firstResult?.email ?? "unknown"}`
    : `Usage summary (${results.length} accounts)`;

  const blocks = results.map((r) =>
    formatUsageBlock(r, r.email === currentEmail),
  );
  const lines = [header, "", blocks.join("\n\n")];

  if (options?.showTip) {
    lines.push("", "Tip: Run `usage --all` to see all accounts.");
  }

  return lines.join("\n");
}

export function formatAccountActionResult(
  title: "Added account" | "Active account" | "Removed account",
  account: AccountRecord,
): string {
  return [title, "", ...formatKeyValueLines([
    ["Email", account.email],
    ["Account ID", account.accountId],
  ])].join("\n");
}

function formatUsageBlock(result: UsageResult, isCurrent: boolean): string {
  const emailLine = isCurrent ? `▶ ${result.email} (Current)` : result.email;

  if (!result.ok) {
    return [
      emailLine,
      ...formatKeyValueLines([
        ["Status", "error"],
        ["Code", result.code],
        ["Detail", result.error],
      ]),
    ].join("\n");
  }

  const { snapshot } = result;
  const primaryLabel = formatUsageWindowLabel(snapshot.primaryWindow, 300);
  const secondaryLabel = formatUsageWindowLabel(snapshot.secondaryWindow, 10_080);
  const shouldShowSecondaryWindow =
    snapshot.secondaryWindow !== null
    || snapshot.secondaryWindowIssue === null
    || secondaryLabel !== primaryLabel;

  return [
    emailLine,
    ...formatKeyValueLines([
      ...formatObservedEmailLines(result.email, snapshot.observedEmail),
      ["Plan", capitalizeFirst(snapshot.planType ?? "unknown")],
      [primaryLabel, formatUsageWindow(
        snapshot.primaryWindow,
        snapshot.fetchedAt,
      )],
      ...(
        shouldShowSecondaryWindow
          ? [[secondaryLabel, formatUsageWindow(
            snapshot.secondaryWindow,
            snapshot.fetchedAt,
            snapshot.secondaryWindowIssue,
          )] as [string, string]]
          : []
      ),
    ]),
  ].join("\n");
}

function formatUsageWindow(
  window: UsageWindow | null,
  anchorTimestamp: string,
  issue: UsageWindowIssueCode | null = null,
): string {
  if (!window) {
    if (issue === "malformed") {
      return "not returned by usage endpoint";
    }

    return "n/a";
  }

  if (window.usedPercent != null) {
    const remainingPercent = formatRemainingPercent(window.usedPercent);
    const summary = `${formatUsageMeter(remainingPercent)} ${remainingPercent}% left`;
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

function formatUsageMeter(remainingPercent: number): string {
  const clampedPercent = Math.min(100, Math.max(0, remainingPercent));
  const filledUnits = Math.round((clampedPercent / 100) * USAGE_METER_WIDTH);
  return `[${USAGE_METER_FILLED.repeat(filledUnits)}${USAGE_METER_EMPTY.repeat(USAGE_METER_WIDTH - filledUnits)}]`;
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
