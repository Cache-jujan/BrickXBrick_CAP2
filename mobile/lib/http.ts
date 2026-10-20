// One fetch for every call to our API (lib/api.ts, lib/receipt-scans.ts).
// Two rules on top of fetch:
// - A 401 means the saved sign-in expired, so the user is sent to the sign-in
//   screen with an explanation (handleUnauthorized). Queued offline work is
//   kept and sent after they sign in again.
// - Reads (GET) are retried once on a dead reused connection
//   (lib/retry-fetch.ts); writes are sent once, so nothing is saved twice.
import { handleUnauthorized } from "@/lib/auth";
import { fetchWithRetry } from "@/lib/retry-fetch";

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const res = await (method === "GET" ? fetchWithRetry(input, init) : fetch(input, init));
  if (res.status === 401) handleUnauthorized();
  return res;
}
