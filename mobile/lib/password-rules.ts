// The password rules, the same four the server enforces (backend/src/lib/passwordRules.js)
// and the web app shows. These checks only tell the person what is still missing.

export type PasswordRuleId = "length" | "upper" | "number" | "special";

export const PASSWORD_RULES: { id: PasswordRuleId; labelKey: string; test: (p: string) => boolean }[] = [
  { id: "length", labelKey: "pw.rule_length", test: (p) => p.length >= 8 },
  { id: "upper", labelKey: "pw.rule_upper", test: (p) => /[A-Z]/.test(p) },
  { id: "number", labelKey: "pw.rule_number", test: (p) => /[0-9]/.test(p) },
  { id: "special", labelKey: "pw.rule_special", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export function passwordMeetsRules(password: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(password));
}
