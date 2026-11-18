// The password rules, the same four on the server (backend/src/lib/passwordRules.js)
// and in the phone app. The server is the one that enforces them; these checks
// just tell the person what is still missing while they type.

export const PASSWORD_RULES = [
  { id: "length", labelKey: "pw.rule_length", test: (p) => p.length >= 8 },
  { id: "upper", labelKey: "pw.rule_upper", test: (p) => /[A-Z]/.test(p) },
  { id: "number", labelKey: "pw.rule_number", test: (p) => /[0-9]/.test(p) },
  { id: "special", labelKey: "pw.rule_special", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

/** Each rule with whether the password meets it. */
export function checkPassword(password) {
  const value = password || "";
  return PASSWORD_RULES.map((rule) => ({ id: rule.id, labelKey: rule.labelKey, ok: rule.test(value) }));
}

export function passwordMeetsRules(password) {
  return checkPassword(password).every((rule) => rule.ok);
}
