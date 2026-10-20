// One fetch for every call to our API (lib/api.ts, lib/receipt-scans.ts).
// It only adds one rule: a 401 means the saved sign-in expired, so the user is
// sent to the sign-in screen with an explanation (handleUnauthorized). Queued
// offline work is kept and sent after they sign in again.
import { handleUnauthorized } from "@/lib/auth";

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) handleUnauthorized();
  return res;
}
