import type { UsageFailureCode } from "../types.js";

export type UsageHttpFailure = {
  code: UsageFailureCode;
  event: string;
  message: string;
};

export function mapUsageHttpFailure(status: number): UsageHttpFailure {
  if (status === 400) {
    return {
      code: "bad_request",
      event: "usage.http.bad_request",
      message: "Usage endpoint rejected the request",
    };
  }

  if (status === 404 || status === 410) {
    return {
      code: "endpoint_missing",
      event: "usage.http.endpoint_missing",
      message: "Usage endpoint is missing",
    };
  }

  if (status === 405) {
    return {
      code: "unsupported_method",
      event: "usage.http.unsupported_method",
      message: "Usage endpoint does not support this method",
    };
  }

  if (status === 409 || status === 415 || status === 422) {
    return {
      code: "invalid_response_contract",
      event: "usage.http.invalid_response_contract",
      message: "Usage endpoint rejected the request contract",
    };
  }

  if (status === 429) {
    return {
      code: "rate_limited",
      event: "usage.http.rate_limited",
      message: "Usage endpoint rate limited the request",
    };
  }

  if (status >= 500) {
    return {
      code: "service_unavailable",
      event: "usage.http.service_unavailable",
      message: "Usage endpoint returned a server error",
    };
  }

  return {
    code: "endpoint_changed",
    event: "usage.http.endpoint_changed",
    message: "Usage endpoint returned an unexpected client error",
  };
}
