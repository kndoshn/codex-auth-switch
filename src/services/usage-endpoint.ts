import { UsageFetchError } from "../lib/errors.js";
import { logDebug, logWarn } from "../lib/log.js";
import { mapUsageHttpFailure } from "../lib/usage-http.js";

const USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";

export async function requestUsagePayload(accessToken: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(USAGE_ENDPOINT, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (error) {
    logWarn("usage.http.network_failure", "Failed to reach usage endpoint.", {
      error,
    });
    if (error instanceof Error) {
      throw new UsageFetchError("network_error", error.message, { cause: error });
    }
    throw new UsageFetchError("network_error", "Failed to reach usage endpoint.");
  }

  logDebug("usage.http.response", "Received usage endpoint response.", {
    status: response.status,
    ok: response.ok,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      logWarn("usage.http.unauthorized", "Usage endpoint rejected the saved session.", {
        status: response.status,
      });
      throw new UsageFetchError("unauthorized", `Usage endpoint rejected the saved session: HTTP ${response.status}`);
    }

    const failure = mapUsageHttpFailure(response.status);
    logWarn(failure.event, failure.message, {
      status: response.status,
      code: failure.code,
    });
    throw new UsageFetchError(failure.code, `${failure.message}: HTTP ${response.status}`);
  }

  try {
    return await response.json();
  } catch (error) {
    logWarn("usage.http.invalid_json", "Usage endpoint returned invalid JSON.", {
      error,
    });
    if (error instanceof Error) {
      throw new UsageFetchError("malformed_response", error.message);
    }
    throw new UsageFetchError("malformed_response", "Usage endpoint returned invalid JSON.");
  }
}
