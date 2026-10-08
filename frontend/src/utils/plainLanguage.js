// Plain-language copy for the blockchain (F12) and fraud-screening (F9)
// features. The backend keeps its technical values (Confirmed, TamperDetected,
// Ticket_Mismatch, tx hashes); everything a General Manager or client reads
// goes through here so the wording stays the same on every page.

export const PESO_EXACT = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// What each blockchainStatus value means to someone who has never heard of
// a blockchain. `tone` maps to the ChainStatus pill colors.
export const CHAIN_STATUS = {
  Confirmed: {
    tone: "secured",
    label: "Record secured",
    description: "A tamper-proof copy was saved when this expense was approved. Any later edit will be caught.",
  },
  Pending: {
    tone: "pending",
    label: "Securing record",
    description: "The tamper-proof copy is being saved. This usually finishes within a few minutes.",
  },
  TamperDetected: {
    tone: "changed",
    label: "Changed after approval",
    description: "This expense no longer matches what was approved. Review it with your System Administrator.",
  },
  None: {
    tone: "none",
    label: "Not yet secured",
    description: "Only approved expenses get a tamper-proof copy.",
  },
};

export function chainStatusInfo(status) {
  return CHAIN_STATUS[status] || CHAIN_STATUS.None;
}

// tamper_alerts rows store onChainHash = "MISSING" when the saved copy
// itself could not be found, versus a real mismatch.
export function tamperReason(alert) {
  if (!alert?.onchainhash || alert.onchainhash === "MISSING") {
    return "The tamper-proof copy of this expense could not be found.";
  }
  return "Its details were edited after it was approved.";
}

const FLAG_LABELS = {
  Ticket_Mismatch: "Doesn't match the material request",
  Vendor_Validation: "Vendor needs checking",
  BIR_Duplicate: "Possible duplicate receipt",
};

export function flagLabel(flagType) {
  return FLAG_LABELS[flagType] || String(flagType || "").replace(/_/g, " ");
}

// Turns the backend's notification text into something a non-technical
// reader understands. Handles both the old technical format
// ('Tamper detected: expense "X" (₱123.00) — recomputed hash …') and anything
// else, which is shown unchanged.
const TAMPER_MESSAGE = /^Tamper detected: expense "(.*)" \(₱([\d.,]+)\) — (.*)$/s;

export function humanizeNotification(message) {
  const match = TAMPER_MESSAGE.exec(message || "");
  if (!match) return message;
  const [, vendor, rawAmount, reason] = match;
  const amount = Number(rawAmount.replace(/,/g, ""));
  const money = Number.isFinite(amount) ? PESO_EXACT.format(amount) : `₱${rawAmount}`;
  if (/could not be found/i.test(reason)) {
    return `We couldn't find the tamper-proof copy of "${vendor}" (${money}). Please contact your System Administrator.`;
  }
  return `"${vendor}" (${money}) was changed after it was approved. Its details no longer match the approved record.`;
}

// Verify endpoint error text is technical (503 "Blockchain nodes are
// unreachable…"). Anything we don't recognise is passed through.
export function humanizeVerifyError(message) {
  if (/unreachable|ECONNREFUSED|ETIMEDOUT|network/i.test(message || "")) {
    return "We can't run the check right now because the verification servers didn't respond. Your records are safe. Try again in a few minutes.";
  }
  if (/No blockchain record/i.test(message || "")) {
    return "This expense hasn't been secured yet, so there's nothing to check against.";
  }
  return message || "The check couldn't be completed. Try again in a few minutes.";
}
