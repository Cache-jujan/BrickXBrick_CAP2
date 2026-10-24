// Plain-language copy for the blockchain (F12) and fraud-screening (F9)
// features. The backend keeps its technical values (Confirmed, TamperDetected,
// Ticket_Mismatch, tx hashes); everything a General Manager or client reads
// goes through here so the wording stays the same on every page. The wording
// itself lives in shared/i18n/messages.json; these helpers pick the right key.

export const PESO_EXACT = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// What each blockchainStatus value means to someone who has never heard of
// a blockchain. `tone` maps to the ChainStatus pill colors and to the catalog
// keys chain.<tone>.label and chain.<tone>.description.
export const CHAIN_STATUS = {
  Confirmed: { tone: "secured" },
  Pending: { tone: "pending" },
  TamperDetected: { tone: "changed" },
  None: { tone: "none" },
};

export function chainStatusInfo(status) {
  const { tone } = CHAIN_STATUS[status] || CHAIN_STATUS.None;
  return { tone, labelKey: `chain.${tone}.label`, descriptionKey: `chain.${tone}.description` };
}

// tamper_alerts rows store onChainHash = "MISSING" when the saved copy
// itself could not be found, versus a real mismatch. Returns a catalog key.
export function tamperReasonKey(alert) {
  return !alert?.onchainhash || alert.onchainhash === "MISSING" ? "tamper.reason_missing" : "tamper.reason_edited";
}

// `tv` is the translate-a-backend-value helper from useLocale(). A flag type
// the catalog doesn't know is shown with its underscores replaced by spaces.
export function flagLabel(flagType, tv) {
  const label = tv("flag", flagType);
  return label !== flagType ? label : String(flagType || "").replace(/_/g, " ");
}

// Turns the backend's notification text into something a non-technical
// reader understands. Handles both the old technical format
// ('Tamper detected: expense "X" (₱123.00) — recomputed hash …') and anything
// else, which is shown unchanged. `t` is the translate function from useLocale().
const TAMPER_MESSAGE = /^Tamper detected: expense "(.*)" \(₱([\d.,]+)\) — (.*)$/s;

export function humanizeNotification(message, t) {
  const match = TAMPER_MESSAGE.exec(message || "");
  if (!match) return message;
  const [, vendor, rawAmount, reason] = match;
  const amount = Number(rawAmount.replace(/,/g, ""));
  const money = Number.isFinite(amount) ? PESO_EXACT.format(amount) : `₱${rawAmount}`;
  const key = /could not be found/i.test(reason) ? "notice.tamper_missing" : "notice.tamper_changed";
  return t(key, { vendor, amount: money });
}

// Verify endpoint error text is technical (503 "Blockchain nodes are
// unreachable…"). Anything we don't recognise is passed through.
export function humanizeVerifyError(message, t) {
  if (/unreachable|ECONNREFUSED|ETIMEDOUT|network/i.test(message || "")) return t("verify.err_unreachable");
  if (/No blockchain record/i.test(message || "")) return t("verify.err_none");
  return message || t("verify.err_generic");
}
