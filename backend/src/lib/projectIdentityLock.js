// projectIdentityLock.js: who the project is for and what kind of project it is
// are locked once a project leaves Draft (Nov 2026 refinement, with projectDateLock.js).
//
// The client's name is on the contract and the BOM agreement, and the project type
// decided the starting document checklist and milestones. After activation changing
// either would leave those records describing a different project, so neither can
// change, for anyone, the General Manager included. The project name, description
// and site details stay editable: they are corrections, not a different project.
//
// Completed / Cancelled / Archived projects never reach this check, the edit
// route already refuses them with its own 409.

const { httpError } = require("./projectRules");

function identityIsLocked(status) {
  return status !== "Draft";
}

// Client names compare ignoring case and surrounding spaces, so fixing a capital
// letter is not a change of client.
function same(a, b) {
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
}

// existing: the stored projects row (Postgres lowercases column names).
// fields:   the validated, merged values about to be saved.
// Returns the locked fields the edit tries to change (empty = fine).
function lockedIdentityChanges(existing, fields) {
  if (!existing || !identityIsLocked(existing.status)) return [];
  const changes = [];
  if (!same(fields.clientName, existing.clientname)) {
    changes.push({ field: "clientName", message: "Client name is locked once the project is active and can't be changed" });
  }
  // An old row with no type yet may still be given one.
  if (existing.projecttype && fields.projectType !== existing.projecttype) {
    changes.push({ field: "projectType", message: "Project type is locked once the project is active and can't be changed" });
  }
  return changes;
}

function assertIdentityUnlocked(existing, fields) {
  const changes = lockedIdentityChanges(existing, fields);
  if (changes.length === 0) return;
  throw httpError(409, changes.map((c) => c.message).join("; "), { fieldErrors: changes });
}

module.exports = { identityIsLocked, lockedIdentityChanges, assertIdentityUnlocked };
