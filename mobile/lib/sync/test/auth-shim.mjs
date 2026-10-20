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
