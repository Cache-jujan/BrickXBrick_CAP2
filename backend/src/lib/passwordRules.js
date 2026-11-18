// The password rules, in one place. The web and mobile apps show the same four
// as a checklist (frontend/src/utils/passwordRules.js, mobile/lib/password-rules.ts).
const MIN_PASSWORD_LENGTH = 8;

const RULES = [
  { id: "length", test: (p) => p.length >= MIN_PASSWORD_LENGTH },
  { id: "upper", test: (p) => /[A-Z]/.test(p) },
  { id: "number", test: (p) => /[0-9]/.test(p) },
  { id: "special", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

/** Ids of the rules this password breaks; an empty list means it is acceptable. */
function brokenPasswordRules(password) {
  const value = typeof password === "string" ? password : "";
  return RULES.filter((rule) => !rule.test(value)).map((rule) => rule.id);
}

const PASSWORD_RULES_MESSAGE =
  "New password needs at least 8 characters, one uppercase letter, one number and one special character.";

module.exports = { MIN_PASSWORD_LENGTH, brokenPasswordRules, PASSWORD_RULES_MESSAGE };
