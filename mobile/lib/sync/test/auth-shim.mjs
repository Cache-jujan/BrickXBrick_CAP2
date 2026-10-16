let session = null;
export const getSession = () => session;
export const setSession = (next) => {
  session = next;
};
