#!/usr/bin/env bash
# =============================================================================
# Brick x Brick — FULL scaffold (base repo structure + F1 files)
# Run this from INSIDE your project folder (e.g. BrickXBrick_CAP2).
# Safe to re-run: it won't overwrite files that already exist.
# =============================================================================
set -e

# Small helper: only write a file if it doesn't already exist.
# This makes the script safe to run again without clobbering your work.
write_if_absent () {
  local path="$1"
  if [ -e "$path" ]; then
    echo "  skip (exists): $path"
  else
    mkdir -p "$(dirname "$path")"
    cat > "$path"
    echo "  created: $path"
  fi
}

echo "== Base repo structure =="

mkdir -p backend/src web/src mobile/src blockchain infra/db docs

# --- .gitignore -------------------------------------------------------------
write_if_absent ".gitignore" << 'EOF'
node_modules/
.env
.env.local
dist/
build/
*.log
.DS_Store
android/app/build/
ios/build/
geth-data/
keystore/
password.txt
EOF

# --- README -----------------------------------------------------------------
write_if_absent "README.md" << 'EOF'
# Brick x Brick
Construction Management IS with Blockchain-Secured Financial Controls — FourLoop()

## Structure
- backend/    Node.js + Express API
- web/        React.js dashboard
- mobile/     React Native (Android)
- blockchain/ Geth PoA network config
- infra/db/   PostgreSQL schema (source of truth: manuscript Ch.3 Data Dictionary)
- docs/       Reference docs pulled from the manuscript
EOF

# --- root .env.example ------------------------------------------------------
write_if_absent ".env.example" << 'EOF'
DATABASE_URL=postgresql://user:password@localhost:5432/brickxbrick
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWKS_URL=
GCP_VISION_API_KEY=
R2_ACCOUNT_ID=
R2_ACCESS_KEY=
R2_SECRET_KEY=
R2_BUCKET=
GETH_RPC_URL=http://localhost:8545
EOF

# --- docker-compose.yml (Postgres 14 + auto-loads schema.sql) ---------------
write_if_absent "docker-compose.yml" << 'EOF'
version: "3.9"
services:
  postgres:
    image: postgres:14
    restart: unless-stopped
    environment:
      POSTGRES_USER: brickuser
      POSTGRES_PASSWORD: brickpass
      POSTGRES_DB: brickxbrick
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./infra/db/schema.sql:/docker-entrypoint-initdb.d/schema.sql
volumes:
  pgdata:
EOF

# --- placeholder schema note ------------------------------------------------
write_if_absent "infra/db/README.md" << 'EOF'
Place the full manuscript schema here as schema.sql (Tables 29-38).
docker-compose loads it automatically on first Postgres startup.
EOF

echo "== F1 backend =="

mkdir -p backend/src/middleware backend/src/routes backend/src/lib

write_if_absent "backend/package.json" << 'EOF'
{
  "name": "brickxbrick-backend",
  "version": "0.1.0",
  "description": "Brick x Brick backend API (Node.js + Express)",
  "main": "src/server.js",
  "type": "commonjs",
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "jose": "^5.6.3",
    "pg": "^8.12.0"
  }
}
EOF

write_if_absent "backend/.env.example" << 'EOF'
PORT=3000
DATABASE_URL=postgresql://brickuser:brickpass@localhost:5432/brickxbrick
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWKS_URL=
EOF

write_if_absent "backend/src/lib/db.js" << 'EOF'
// db.js — one shared Postgres connection pool for the whole app.
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function query(text, params) { return pool.query(text, params); }
module.exports = { query, pool };
EOF

write_if_absent "backend/src/lib/supabaseAdmin.js" << 'EOF'
// supabaseAdmin.js — Supabase client using the SERVICE-ROLE key.
// Backend-only. This key can create/delete auth users. Never ship to browser.
const { createClient } = require("@supabase/supabase-js");
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
module.exports = { supabaseAdmin };
EOF

write_if_absent "backend/src/middleware/auth.js" << 'EOF'
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
EOF

write_if_absent "backend/src/middleware/requireRole.js" << 'EOF'
// requireRole.js — RBAC gate. Use AFTER requireAuth.
function requireRole(...allowedRoles) {
  return function (req, res, next) {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden: insufficient role" });
    }
    next();
  };
}
module.exports = { requireRole };
EOF

write_if_absent "backend/src/routes/adminUsers.js" << 'EOF'
// adminUsers.js — the five F1 account actions. System Administrator only.
const express = require("express");
const { query } = require("../lib/db");
const { supabaseAdmin } = require("../lib/supabaseAdmin");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();
router.use(requireAuth, requireRole("System Administrator"));

const VALID_ROLES = [
  "General Manager", "Project Manager", "Site Manager",
  "Purchaser", "System Administrator"
];

// CREATE
router.post("/", async (req, res) => {
  const { name, email, role, tempPassword } = req.body;
  if (!name || !email || !role) {
    return res.status(400).json({ error: "name, email, role are required" });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }
  try {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword || Math.random().toString(36).slice(2) + "Aa1!",
      email_confirm: true,
      user_metadata: { role }
    });
    if (error) return res.status(400).json({ error: error.message });
    const result = await query(
      `INSERT INTO Users (name, email, supabaseUserId, role, status)
       VALUES ($1, $2, $3, $4, 'Active')
       RETURNING userID, name, email, role, status`,
      [name, email, data.user.id, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LIST
router.get("/", async (req, res) => {
  const result = await query(
    `SELECT userID, name, email, role, status, lockoutUntil, createdAt
     FROM Users ORDER BY createdAt DESC`
  );
  res.json(result.rows);
});

// MODIFY
router.patch("/:id", async (req, res) => {
  const { role, status } = req.body;
  if (role && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }
  const result = await query(
    `UPDATE Users SET role = COALESCE($1, role), status = COALESCE($2, status)
     WHERE userID = $3
     RETURNING userID, name, email, role, status`,
    [role || null, status || null, req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
  res.json(result.rows[0]);
});

// DEACTIVATE
router.post("/:id/deactivate", async (req, res) => {
  const result = await query(
    `UPDATE Users SET status = 'Inactive' WHERE userID = $1
     RETURNING userID, status`,
    [req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
  res.json(result.rows[0]);
});

// UNLOCK (admin early-unlock)
router.post("/:id/unlock", async (req, res) => {
  const result = await query(
    `UPDATE Users SET lockoutUntil = NULL WHERE userID = $1
     RETURNING userID, lockoutUntil`,
    [req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });
  res.json(result.rows[0]);
});

module.exports = router;
EOF

write_if_absent "backend/src/server.js" << 'EOF'
// server.js — entry point. Wires middleware + routes together.
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const adminUsers = require("./routes/adminUsers");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/api/admin/users", adminUsers);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
EOF

echo "== F1 web placeholders =="

write_if_absent "web/src/supabaseClient.js" << 'EOF'
// supabaseClient.js — FRONTEND client. ANON key only (safe for browser).
import { createClient } from "@supabase/supabase-js";
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
EOF

write_if_absent "web/.env.example" << 'EOF'
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=http://localhost:3000
EOF

echo ""
echo "DONE. Nothing installed yet."
echo "Next: cd backend && npm install"
