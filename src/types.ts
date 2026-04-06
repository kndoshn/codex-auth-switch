export type AccountRecord = {
  profileId: string;
  email: string;
  accountId: string;
  authPath: string;
  createdAt: string;
  lastUsedAt: string;
};

export type StoredAuthFile = {
  raw: string;
  accountId: string;
  accessToken: string;
};

export type CodexCredentialStoreMode = "file" | "keyring" | "auto";

export type ResolvedCodexCredentialStoreMode = "file" | "keyring" | "unresolved";

export type AppState = {
  currentProfileId: string | null;
  accounts: Record<string, AccountRecord>;
};

export type UsageWindow = {
  usedPercent: number | null;
  resetAt: string | null;
  windowMinutes: number | null;
};

export type UsageWindowIssueCode =
  | "malformed";

export type UsageFailureCode =
  | "auth_missing"
  | "auth_invalid"
  | "auth_mismatch"
  | "bad_request"
  | "endpoint_missing"
  | "unsupported_method"
  | "invalid_response_contract"
  | "endpoint_changed"
  | "network_error"
  | "rate_limited"
  | "service_unavailable"
  | "unauthorized"
  | "malformed_response";

export type UsageSnapshot = {
  email: string;
  observedEmail: string | null;
  planType: string | null;
  primaryWindow: UsageWindow | null;
  secondaryWindow: UsageWindow | null;
  secondaryWindowIssue: UsageWindowIssueCode | null;
  fetchedAt: string;
};

export type UsageResult =
  | {
      email: string;
      ok: true;
      snapshot: UsageSnapshot;
    }
  | {
      email: string;
      ok: false;
      code: UsageFailureCode;
      error: string;
    };
