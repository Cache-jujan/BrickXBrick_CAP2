// F10 — quiet logging for the offline/sync code.
//
// console.warn and console.error pop up as toasts in a development build, and
// a phone without signal fails a request every few seconds, so expected
// offline failures must never use them. This writes to the Metro terminal only,
// and only in development.
export function devLog(...args) {
  if (typeof __DEV__ !== "undefined" && __DEV__) console.log(...args);
}
