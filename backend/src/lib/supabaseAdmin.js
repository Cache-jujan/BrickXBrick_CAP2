// supabaseAdmin.js — Supabase client using the SERVICE-ROLE key.
// Backend-only. This key can create/delete auth users. Never ship to browser.
const { createClient } = require("@supabase/supabase-js");
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
module.exports = { supabaseAdmin };
