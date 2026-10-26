const REQUEST_TIMEOUT_MS = 15_000;

// Bounds connection, headers and body reads so a stalled endpoint cannot hang the CLI.
export async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

export function formatTimeoutMessage(endpointLabel: string): string {
  return `${endpointLabel} did not respond within ${REQUEST_TIMEOUT_MS / 1_000} seconds.`;
}
