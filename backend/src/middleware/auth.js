const { createRemoteJWKSet, jwtVerify } = require("jose");
const { query } = require("../lib/db");

if (!process.env.SUPABASE_JWKS_URL) {
  // Fail loudly at boot rather than crashing cryptically on the first request.
  throw new Error(
    "SUPABASE_JWKS_URL is not set. requireAuth cannot verify tokens without it."
  );
}
if (!process.env.SUPABASE_URL) {
  throw new Error(
    "SUPABASE_URL is not set. requireAuth needs it to validate the token issuer."
  );
}

const JWKS = createRemoteJWKSet(new URL(process.env.SUPABASE_JWKS_URL), {
  cooldownDuration: 30_000, // ms between refetches after a failed key lookup
  timeoutDuration: 5_000,   // ms before a JWKS fetch is aborted
});

const EXPECTED_ISSUER = `${process.env.SUPABASE_URL}/auth/v1`;
const EXPECTED_AUDIENCE = "authenticated";

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No token provided" });

  // --- Step 1: verify the JWT itself. Failures here are genuine auth failures. 
  let payload;
  try {
    const verified = await jwtVerify(token, JWKS, {
      issuer: EXPECTED_ISSUER,
      audience: EXPECTED_AUDIENCE,
    });
    payload = verified.payload;
  } catch (err) {
    console.error("JWT verify failed:", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // --- Step 2: look up the user in Neon. Failures here are DB failures, not auth failures.
  let dbUser;
  try {
    const result = await query(
      `SELECT userid, name, email, role, status FROM users WHERE supabaseuserid = $1`,
      [payload.sub]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: "User not found" });
    }
    dbUser = result.rows[0];
  } catch (err) {
    console.error("DB error in requireAuth:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }

  if (dbUser.status !== "Active") {
    return res.status(403).json({ error: "Account is not active" });
  }

  req.user = {
    id: dbUser.userid,
    email: dbUser.email,
    role: dbUser.role,
  };
  next();
}

module.exports = { requireAuth };