let session = null;
export const getSession = () => session;
export const setSession = (next) => {
  session = next;
};
export const unauthorized = { calls: 0 };
export const handleUnauthorized = () => {
  unauthorized.calls += 1;
  session = null;
};

// Stand-ins for the sign-in refresh (lib/auth.ts). A test sets refresh.outcome to
// what the server would have said: "refreshed" | "rejected" | "later" | "unavailable".
export const refresh = { outcome: "unavailable", calls: 0, ensureCalls: 0 };
export const refreshSession = async () => {
  refresh.calls += 1;
  return refresh.outcome;
};
export const ensureFreshToken = async () => {
  refresh.ensureCalls += 1;
};
