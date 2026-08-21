const { createRemoteJWKSet, jwtVerify } = require("jose");
const { query } = require("../lib/db");

const JWKS = createRemoteJWKSet(new URL(process.env.SUPABASE_JWKS_URL));

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "No token provided" });

    const { payload } = await jwtVerify(token, JWKS);

    const result = await query(
      `SELECT userid, name, email, role, status FROM users WHERE supabaseuserid = $1`,
      [payload.sub]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: "User not found" });
    }

    const dbUser = result.rows[0];

    if (dbUser.status !== "Active") {
      return res.status(403).json({ error: "Account is not active" });
    }

    req.user = {
      id: dbUser.userid,
      email: dbUser.email,
      role: dbUser.role,
    };
    next();
  } catch (err) {
    console.error("JWT verify failed:", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { requireAuth };