import { flushTransientOutput } from "./transient-output.js";

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

export type LogContext = Record<string, unknown>;

export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedError;
};

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

const DEFAULT_LOG_LEVEL: LogLevel = "error";
const REDACTED_VALUE = "[REDACTED]";
const SENSITIVE_KEY_PATTERN = /(token|authorization|cookie|secret|password|raw|session|credential)/i;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi;
const TOKEN_ASSIGNMENT_PATTERNS = [
  /\b(access_token|refresh_token|id_token)\b\s*[:=]\s*["']?[^"',\s]+["']?/gi,
  /"(access_token|refresh_token|id_token)"\s*:\s*"[^"]+"/gi,
  /\b(authorization)\b\s*[:=]\s*["']?Bearer\s+[^"',\s]+["']?/gi,
  /\b(cookie|set-cookie)\b\s*[:=]\s*["']?[^"'\n\r]+["']?/gi,
  /\b(session(?:_id)?|__Secure-[^=\s]+|__Host-[^=\s]+)\b\s*=\s*[^;,\s]+/gi,
];
const SAFE_REDACTION_FALLBACK = "[REDACTION_FAILED]";

export function logError(event: string, message: string, context?: LogContext): void {
  writeLog("error", event, message, context);
}

export function logWarn(event: string, message: string, context?: LogContext): void {
  writeLog("warn", event, message, context);
}

export function logInfo(event: string, message: string, context?: LogContext): void {
  writeLog("info", event, message, context);
}

export function logDebug(event: string, message: string, context?: LogContext): void {
  writeLog("debug", event, message, context);
}

export function isDebugLoggingEnabled(): boolean {
  return getConfiguredLogLevel() === "debug";
}

export function getConfiguredLogLevel(): LogLevel {
  const raw = process.env.CODEX_AUTH_SWITCH_LOG_LEVEL?.trim().toLowerCase();
  if (raw === "error" || raw === "warn" || raw === "info" || raw === "debug" || raw === "silent") {
    return raw;
  }

  return DEFAULT_LOG_LEVEL;
}

export function serializeError(error: unknown): SerializedError | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const serialized: SerializedError = {
    name: error.name,
    message: sanitizeStringSafely(error.message),
  };

  if (isDebugLoggingEnabled() && typeof error.stack === "string" && error.stack.length > 0) {
    serialized.stack = sanitizeStringSafely(error.stack);
  }

  if ("cause" in error) {
    const cause = serializeError(error.cause);
    if (cause) {
      serialized.cause = cause;
    }
  }

  return serialized;
}

function writeLog(
  level: Exclude<LogLevel, "silent">,
  event: string,
  message: string,
  context?: LogContext,
): void {
  if (!shouldLog(level)) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    pid: process.pid,
    level,
    event,
    message: sanitizeStringSafely(message),
    ...sanitizeContext(context),
  };

  flushTransientOutput();
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

function shouldLog(level: Exclude<LogLevel, "silent">): boolean {
  return LOG_LEVEL_RANK[getConfiguredLogLevel()] >= LOG_LEVEL_RANK[level];
}

function sanitizeContext(context: LogContext | undefined): LogContext {
  if (!context) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [key, sanitizeValue(key, value)]),
  );
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (isSensitiveKey(key)) {
    return REDACTED_VALUE;
  }

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(key, item));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nested]) => [nestedKey, sanitizeValue(nestedKey, nested)]),
    );
  }

  if (
    typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
    || value === null
  ) {
    return sanitizeScalarValue(key, value);
  }

  return String(value);
}

function sanitizeScalarValue(key: string, value: string | number | boolean | null): unknown {
  if (value === null || typeof value !== "string") {
    return value;
  }

  if (isSensitiveKey(key)) {
    return REDACTED_VALUE;
  }

  return sanitizeStringSafely(value);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function sanitizeStringSafely(value: string): string {
  try {
    return sanitizeString(value);
  } catch {
    return SAFE_REDACTION_FALLBACK;
  }
}

function sanitizeString(value: string): string {
  let sanitized = value.replaceAll(BEARER_TOKEN_PATTERN, `Bearer ${REDACTED_VALUE}`);
  for (const pattern of TOKEN_ASSIGNMENT_PATTERNS) {
    sanitized = sanitized.replaceAll(pattern, (_match, key: string) => `${key}=${REDACTED_VALUE}`);
  }

  return sanitized;
}
