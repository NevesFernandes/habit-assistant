// Shared by every client that talks to our own /api/* endpoints
// (agentClient.ts, transcribeClient.ts). A bare fetch() throws a generic
// "Failed to fetch" TypeError when the request never gets a response at
// all (offline, server down, CORS/service-worker interference) — distinct
// from the server responding with an error, and from the server responding
// with something that isn't valid JSON (a crashed process, a proxy error
// page). Each gets its own message here so callers never have to show that
// raw, uninformative string to the user.

export interface JsonResponse<T> {
  ok: boolean;
  status: number;
  body: T;
}

export async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<JsonResponse<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    throw new Error(
      navigator.onLine
        ? "Couldn't reach the server — check your connection and try again."
        : "You're offline — check your connection and try again.",
    );
  }

  let body: T;
  try {
    body = (await res.json()) as T;
  } catch {
    throw new Error("Something went wrong on the server — try again in a moment.");
  }

  return { ok: res.ok, status: res.status, body };
}
