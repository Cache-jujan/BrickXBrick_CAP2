// displayName.js — the "username.role" label shown on the organizational side.

const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/;

function roleSlug(role) {
  return String(role || "").trim().toLowerCase().replace(/\s+/g, "-");
}

// "jala" + "Site Manager" -> "jala.site-manager"
function orgName(username, role) {
  return `${username}.${roleSlug(role)}`;
}

module.exports = { USERNAME_RE, roleSlug, orgName };
