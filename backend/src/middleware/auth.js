// auth.js — verifies the JWT Supabase issued at login (via JWKS).
// Frontend sends: Authorization: Bearer <token>
const { createRemoteJWKSet, jwtVerify } = require("jose");
const JWKS = createRemoteJWKSet(new URL(process.env.SUPABASE_JWKS_URL));

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "No token provided" });
    const { payload } = await jwtVerify(token, JWKS);
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.user_metadata?.role || payload.app_metadata?.role || null
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
module.exports = { requireAuth };
