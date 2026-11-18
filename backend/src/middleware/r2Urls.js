// r2Urls.js: the private-bucket model for every API route at once.
//
// Stored values stay as <R2_PUBLIC_BASE_URL>/<key> (see lib/r2.js). On the way OUT, every
// string in a JSON response that is one of those URLs is replaced by a signed GET URL
// (1 hour), so avatars, check-in photos, task evidence, receipts, ticket photos and task
// documents all load while the bucket is private, whichever route or `SELECT t.*` they come
// from. On the way IN, a signed URL a client sends back is turned into the stored form, so
// lookups such as "is this a receipt we stored" keep matching.
//
// Both walks copy what they change: a row object that a route keeps (a cache) is never
// edited, so a later response still sees the stored URL and signs it afresh.

const r2 = require("../lib/r2");

function isWalkable(value) {
  if (Array.isArray(value)) return true;
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Every distinct string in `value` that `matches`.
function collect(value, matches, found = new Set()) {
  if (typeof value === "string") {
    if (matches(value)) found.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collect(item, matches, found);
  } else if (isWalkable(value)) {
    for (const key of Object.keys(value)) collect(value[key], matches, found);
  }
  return found;
}

// A copy of `value` with strings in `map` replaced; untouched parts are shared, not copied.
function replace(value, map) {
  if (typeof value === "string") return map.has(value) ? map.get(value) : value;
  if (Array.isArray(value)) {
    let out = null;
    value.forEach((item, i) => {
      const next = replace(item, map);
      if (next !== item) {
        if (!out) out = value.slice();
        out[i] = next;
      }
    });
    return out || value;
  }
  if (isWalkable(value)) {
    let out = null;
    for (const key of Object.keys(value)) {
      const next = replace(value[key], map);
      if (next !== value[key]) {
        if (!out) out = { ...value };
        out[key] = next;
      }
    }
    return out || value;
  }
  return value;
}

// deps are injectable for tests: { baseUrl, sign(url) -> Promise<string|null> }.
function makeSignResponseUrls(deps = {}) {
  const baseUrl = () => {
    const raw = deps.baseUrl !== undefined ? deps.baseUrl : process.env.R2_PUBLIC_BASE_URL;
    return raw ? `${String(raw).replace(/\/$/, "")}/` : null;
  };
  const sign = deps.sign || ((url) => r2.getSignedReadUrlFromPublicUrl(url));

  async function signUrls(body) {
    const prefix = baseUrl();
    if (!prefix) return body;
    const urls = collect(body, (s) => s.startsWith(prefix));
    if (urls.size === 0) return body;
    const map = new Map();
    await Promise.all(
      [...urls].map(async (url) => {
        try {
          const signed = await sign(url);
          if (signed) map.set(url, signed);
        } catch {
          // a URL that cannot be signed is sent as stored rather than failing the whole response
        }
      })
    );
    return replace(body, map);
  }

  return function signResponseUrls(req, res, next) {
    const send = res.json.bind(res);
    res.json = (body) => {
      signUrls(body).then(
        (signed) => send(signed),
        () => send(body)
      );
      return res;
    };
    next();
  };
}

// deps are injectable for tests: { toStored(url) -> string|null }.
function makeStoredUrlsFromRequest(deps = {}) {
  const toStored = deps.toStored || ((url) => r2.storedUrlFromSignedUrl(url));
  return function storedUrlsFromRequest(req, res, next) {
    if (req.body && typeof req.body === "object") {
      const found = collect(req.body, (s) => s.startsWith("https://") && toStored(s) !== null);
      if (found.size > 0) {
        const map = new Map([...found].map((url) => [url, toStored(url)]));
        req.body = replace(req.body, map);
      }
    }
    next();
  };
}

module.exports = {
  signResponseUrls: makeSignResponseUrls(),
  storedUrlsFromRequest: makeStoredUrlsFromRequest(),
  makeSignResponseUrls,
  makeStoredUrlsFromRequest,
  collect,
  replace,
};
