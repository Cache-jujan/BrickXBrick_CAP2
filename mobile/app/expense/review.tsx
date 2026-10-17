import React, { useEffect, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";

import { FlowHeader } from "@/components/flow-header";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { RequestedMaterialPicker, type RequestedMaterial } from "@/components/requested-material-picker";
import { fetchOpenRequests } from "@/lib/api";
import { useExpenseDraft } from "@/lib/expense-draft-context";
import { editLine, unitPriceForPayload, withUnitPrice } from "@/lib/line-math";
import type { LineItem } from "@/lib/expense-types";
import { COLORS } from "@/constants/expense-flow-colors";
import { formatAmountInput, formatPesoCents, groupAmountText, toCents, toHundredths } from "@/lib/money";
import {
  ADJUSTMENT_PREFIX,
  birStatusPreview,
  dateToIso,
  formatReceiptDate,
  isoToDate,
  receiptDateProblem,
  reconcileFix,
  todayIso,
} from "@/lib/receipt-checks";

const RED = "#C1121F";
const AMBER = "#B45309";
const AMBER_BG = "#FEF3C7";
const MEDIUM_OCR_HINT = "Read by the scan, which isn't always right. Check it against the receipt.";

// Our field name -> the key the parser uses in `confidence`.
const CONFIDENCE_KEY: Record<string, string> = {
  vendorName: "vendorName", tin: "tin", birPermitNumber: "birPermitNumber",
  birNumber: "orSiNumber", amount: "amount", receiptDate: "date",
};
const FIELD_LABEL: Record<string, string> = { tin: "TIN", birPermitNumber: "BIR permit" };

function makeId() { return Math.random().toString(36).slice(2, 10); }
// Case, spacing and punctuation don't count as renaming a line.
function simpleText(text: string) { return text.toLowerCase().replace(/[^a-z0-9]+/g, ""); }

export default function ReviewScreen() {
  const { draft, setOcrResult } = useExpenseDraft();
  const result = draft.ocrResult;

  const [vendorName, setVendorName] = useState("");
  const [tin, setTin] = useState("");
  const [birPermitNumber, setBirPermitNumber] = useState("");
  const [birNumber, setBirNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [receiptDate, setReceiptDate] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  // Fields the user has edited: their low-confidence warning is dropped.
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const [iosDateOpen, setIosDateOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  // Materials from the Site Managers' requests, for naming line items.
  const [materials, setMaterials] = useState<RequestedMaterial[]>([]);
  const [pickingItemId, setPickingItemId] = useState<string | null>(null);

  // One receipt for one ticket: only that ticket's material. Split receipt:
  // every open request, since the receipt can fill any of them.
  const ticketId = draft.mode === "single" ? draft.ticket?.ticketId ?? null : null;
  useEffect(() => {
    let cancelled = false;
    fetchOpenRequests()
      .then((requests) => {
        if (cancelled) return;
        const mine = ticketId ? requests.filter((r) => r.ticketID === ticketId) : requests;
        setMaterials(
          mine.map((r) => ({
            key: r.ticketID,
            name: r.materialType,
            detail: `${r.projectName} · ${r.remainingQuantity} still needed · ${r.subject}`,
            bomItemID: r.bomItemID ?? null,
          }))
        );
      })
      // The picker is a shortcut; without it the user types the names.
      .catch((err) => console.warn("Couldn't load requested materials:", err));
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  useEffect(() => {
    if (!result) return;
    setVendorName(result.vendorName ?? "");
    setTin(result.tin ?? "");
    setBirPermitNumber(result.birPermitNumber ?? "");
    setBirNumber(result.birNumber ?? "");
    setAmount(result.amount != null ? groupAmountText(String(result.amount)) : "");
    // No date read off the receipt: default to today (most receipts are
    // logged the day of purchase). It stays amber until the user confirms it.
    setReceiptDate(result.receiptDate ?? todayIso());
    // OCR never reads line items with certainty: "medium" when they add up
    // to the total, "low" otherwise.
    // A rejected expense was confirmed once already, so its rows aren't flagged.
    const lineItemsOcr = draft.resubmit ? undefined : result.confidence?.lineItems === "medium" ? "medium" : "low";
    setItems(
      result.lineItems?.length
        ? result.lineItems.map((li) => withUnitPrice({ id: makeId(), name: li.description ?? "", quantity: li.quantity != null ? String(li.quantity) : "", price: li.amount != null ? groupAmountText(String(li.amount)) : "", unitPrice: li.unitPrice != null ? groupAmountText(String(li.unitPrice)) : "", ocr: lineItemsOcr, scanned: draft.resubmit ? undefined : li.description || undefined }))
        : [{ id: makeId(), name: "", quantity: "", price: result.amount != null ? groupAmountText(String(result.amount)) : "" }]
    );
    setEdited(new Set());
  }, [result, draft.resubmit]);

  if (!result) return <Redirect href="/" />;

  const isSplit = draft.mode === "split";
  const autoFilled = result.autoFilled ?? [];
  // The BIR authority type isn't shown (the purchaser doesn't pick it), so
  // a disagreement on it isn't theirs to resolve.
  const conflicts = (result.vendorConflicts ?? []).filter((c) => c.field !== "birPermitType");

  function edit(field: string, setter: (v: string) => void) {
    return (value: string) => {
      setter(value);
      setEdited((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
    };
  }
  // OCR is never 100%: a scanned value the user hasn't edited is flagged for
  // a check ("medium"), and more strongly when the scan was unsure ("low").
  function ocrCheck(field: string): "medium" | "low" | null {
    if (edited.has(field) || autoFilled.includes(field) || result?.ocrError) return null;
    const level = result?.confidence?.[CONFIDENCE_KEY[field]];
    return level === "low" || level === "medium" ? level : null;
  }
  function isLowConfidence(field: string) {
    if (edited.has(field) || autoFilled.includes(field)) return false;
    return result?.confidence?.[CONFIDENCE_KEY[field]] === "low";
  }

  // Every named line needs a quantity (0 for delivery, VAT, fees) and an amount.
  const namedItems = items.filter((it) => it.name.trim().length > 0);
  const isLineValid = (it: LineItem) => toHundredths(it.quantity) !== null && toCents(it.price) !== null;
  const allLinesValid = namedItems.length > 0 && namedItems.every(isLineValid);
  const totalCents = toCents(amount);
  const linesCents = namedItems.reduce((sum, it) => sum + (toCents(it.price) ?? 0), 0);
  const totalsMatch = totalCents !== null && linesCents === totalCents;
  const dateProblem = receiptDateProblem(receiptDate);
  const vendorMissing = vendorName.trim().length === 0;
  const canContinue = allLinesValid && totalsMatch && !dateProblem && !vendorMissing;
  const bir = birStatusPreview({ tin, birPermitNumber, birNumber });
  // One-tap way out when the lines won't add up (rounding, unlisted VAT or
  // discount). The adjustment line routes the expense to PM review.
  const fix = allLinesValid && !totalsMatch
    ? reconcileFix(totalCents, namedItems.map((it) => ({ id: it.id, name: it.name.trim(), cents: toCents(it.price) })))
    : null;

  // Any edit counts as the user checking that row, so its OCR flag goes.
  function updateItem(id: string, patch: Partial<LineItem>) { setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch, ocr: undefined } : it))); }
  // Qty, unit price and amount move together (lib/line-math.ts).
  function editItem(id: string, field: "quantity" | "price" | "unitPrice", value: string) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...editLine(it, field, value), ocr: undefined } : it)));
  }
  function removeItem(id: string) { setItems((prev) => prev.filter((it) => it.id !== id)); }
  function addItem() { setItems((prev) => [...prev, { id: makeId(), name: "", quantity: "", price: "" }]); }

  function applyFix() {
    if (!fix) return;
    if (fix.kind === "add") {
      setItems((prev) => [...prev, { id: makeId(), name: `${ADJUSTMENT_PREFIX} / rounding`, quantity: "0", price: formatAmountInput(fix.gapCents) }]);
      return;
    }
    // The discount comes off the line; a zero-amount note line records it
    // (and is what flags the expense for PM review).
    setItems((prev) => [
      ...prev.map((it) => (it.id === fix.itemId ? editLine(it, "price", formatAmountInput((toCents(it.price) ?? 0) - fix.gapCents)) : it)),
      { id: makeId(), name: `${ADJUSTMENT_PREFIX}: ${formatPesoCents(fix.gapCents)} discount taken off ${fix.itemName}`, quantity: "0", price: "0.00" },
    ]);
  }

  function fixLabel() {
    if (!fix) return "";
    const gap = formatPesoCents(fix.gapCents);
    return fix.kind === "add" ? `Add ${gap} adjustment line` : `Take ${gap} discount off "${fix.itemName}"`;
  }

  function setDate(date: Date) {
    setReceiptDate(dateToIso(date));
    setEdited((prev) => (prev.has("receiptDate") ? prev : new Set(prev).add("receiptDate")));
  }

  function openDatePicker() {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: isoToDate(receiptDate),
        mode: "date",
        maximumDate: new Date(),
        onChange: (event: DateTimePickerEvent, date?: Date) => {
          if (event.type === "set" && date) setDate(date);
        },
      });
    } else {
      setIosDateOpen((open) => !open);
    }
  }

  function handleContinue() {
    if (vendorMissing) return Alert.alert("Vendor required", "Enter the store or vendor name.");
    if (dateProblem) return Alert.alert("Check the date", dateProblem);
    if (namedItems.length === 0) return Alert.alert("Add at least one item", "Every expense needs at least one line item.");
    if (!allLinesValid) return Alert.alert("Check the line items", "Every line needs a quantity and an amount. Use 0 for delivery, VAT and fees.");
    if (!totalsMatch) {
      if (!fix) return Alert.alert("Totals don't match", "The line items must add up to the receipt total. Check each amount against the paper receipt.");
      return Alert.alert(
        "Totals don't match",
        `The line items are ${formatPesoCents(fix.gapCents)} ${fix.kind === "add" ? "short of" : "over"} the receipt total. Check the paper receipt, or adjust it and a Project Manager will review it.`,
        [{ text: "Check again", style: "cancel" }, { text: fixLabel(), onPress: applyFix }]
      );
    }
    const clean = (text: string) => Number(text.replace(/,/g, "").trim());
    setOcrResult({
      ...result!, vendorName: vendorName.trim(), tin, birPermitNumber, birNumber, amount: clean(amount), receiptDate: receiptDate.trim(),
      lineItems: namedItems.map((it) => ({ description: it.name.trim(), amount: clean(it.price), quantity: clean(it.quantity), unitPrice: unitPriceForPayload(it), bomItemID: it.bomItemID ?? null })),
    });
    router.push(isSplit ? "/expense/allocate" : "/expense/link");
  }

  const file = draft.file;

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlowHeader title="Review receipt" caption={isSplit ? "Split receipt · Step 2 of 3" : "Step 2 of 3"} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {draft.resubmit && (
            <View style={styles.rejectBox}>
              <Text style={styles.rejectTitle}>Your Project Manager rejected this expense</Text>
              <Text style={styles.rejectReason}>{draft.resubmit.reason ? `"${draft.resubmit.reason}"` : "No reason was given."}</Text>
              <Text style={styles.rejectHint}>Fix what they pointed out, then resubmit.</Text>
            </View>
          )}

          {file && (
            <View style={styles.thumbRow}>
              {file.type === "image" ? (
                <Pressable onPress={() => setZoomOpen(true)} accessibilityRole="imagebutton" accessibilityLabel="Enlarge the receipt photo">
                  <Image source={{ uri: file.uri }} style={styles.thumb} resizeMode="cover" />
                </Pressable>
              ) : (
                <View style={[styles.thumb, styles.thumbPdf]}><IconSymbol name="doc.fill" size={26} color={COLORS.muted} /></View>
              )}
              <View style={styles.flex}>
                <Text style={styles.thumbName} numberOfLines={1}>{file.name}</Text>
                <Text style={styles.thumbHint}>{file.type === "image" ? "Tap the photo to enlarge it. " : ""}Compare each value with the paper receipt.</Text>
              </View>
            </View>
          )}

          <View style={[styles.birBadge, bir.formal ? styles.birFormal : styles.birInformal]}>
            <IconSymbol name={bir.formal ? "checkmark.seal.fill" : "info.circle.fill"} size={16} color={bir.formal ? COLORS.success : AMBER} />
            <Text style={[styles.birText, { color: bir.formal ? COLORS.success : AMBER }]}>
              {bir.formal ? "Formal · tax-deductible" : "Informal receipt · still OK to submit"}
            </Text>
          </View>
          {!bir.formal && (
            <Text style={styles.birNote}>
              No {bir.missing.join(", ")} entered, so it won&apos;t count as tax-deductible. Fill them in if the paper shows them.
            </Text>
          )}

          {conflicts.length > 0 && (
            <View style={styles.warnBox}>
              <Text style={styles.warnTitle}>Receipt differs from the vendor list</Text>
              {conflicts.map((c) => (
                <Text key={c.field} style={styles.warnLine}>
                  {FIELD_LABEL[c.field] ?? c.field}: receipt reads {c.ocrValue}, vendor list has {c.masterValue}
                </Text>
              ))}
              <Text style={styles.warnLine}>The vendor list value is filled in. Check the paper receipt before continuing.</Text>
            </View>
          )}

          <Section title="Vendor & tax">
            <Field label="Vendor" value={vendorName} onChangeText={edit("vendorName", setVendorName)} lowConfidence={isLowConfidence("vendorName")} error={vendorMissing ? "Required" : null} />
            <Field label="TIN" value={tin} onChangeText={edit("tin", setTin)} keyboardType="numbers-and-punctuation" lowConfidence={isLowConfidence("tin")} fromVendorList={autoFilled.includes("tin")} />
            <Field label="BIR permit number" value={birPermitNumber} onChangeText={edit("birPermitNumber", setBirPermitNumber)} autoCapitalize="characters" lowConfidence={isLowConfidence("birPermitNumber")} fromVendorList={autoFilled.includes("birPermitNumber")} />
            <Field label="OR / SI number" value={birNumber} onChangeText={edit("birNumber", setBirNumber)} autoCapitalize="characters" lowConfidence={isLowConfidence("birNumber")} />
          </Section>

          <Section title="Amount & date">
            <Field label="Receipt total (₱)" value={amount} onChangeText={edit("amount", setAmount)} onBlur={() => setAmount(groupAmountText)} keyboardType="decimal-pad" lowConfidence={ocrCheck("amount") !== null} lowHint={ocrCheck("amount") === "medium" ? MEDIUM_OCR_HINT : undefined} error={totalCents === null ? "Enter the total, e.g. 1,250.00" : null} />
            {Platform.OS === "web" ? (
              // The native picker has no web build, so the web preview keeps a typed date.
              <Field label="Receipt date" value={receiptDate} onChangeText={edit("receiptDate", setReceiptDate)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" lowConfidence={isLowConfidence("receiptDate")} error={dateProblem} />
            ) : (
              <View style={styles.field}>
                <View style={styles.labelRow}>
                  <Text style={styles.fieldLabel}>Receipt date</Text>
                </View>
                <Pressable
                  onPress={openDatePicker}
                  style={[styles.input, styles.dateInput, isLowConfidence("receiptDate") && styles.inputLow, !!dateProblem && styles.inputError]}
                  accessibilityRole="button"
                  accessibilityLabel={`Receipt date, ${formatReceiptDate(receiptDate)}. Tap to change.`}
                >
                  <Text style={styles.dateText}>{formatReceiptDate(receiptDate)}</Text>
                  <IconSymbol name="calendar" size={18} color={COLORS.muted} />
                </Pressable>
                {iosDateOpen && (
                  <DateTimePicker
                    value={isoToDate(receiptDate)}
                    mode="date"
                    display="inline"
                    maximumDate={new Date()}
                    onChange={(_event: DateTimePickerEvent, date?: Date) => {
                      if (date) setDate(date);
                      setIosDateOpen(false);
                    }}
                  />
                )}
                {dateProblem ? (
                  <Text style={styles.errorHint}>{dateProblem}</Text>
                ) : isLowConfidence("receiptDate") ? (
                  <Text style={styles.lowHint}>
                    {result.receiptDate ? "Low OCR confidence — check this against the receipt." : "Couldn't read the date, so it's set to today. Tap to change."}
                  </Text>
                ) : null}
              </View>
            )}
          </Section>

          <Section
            title={`Line items (${items.length})`}
            action={<Pressable onPress={addItem} hitSlop={8}><Text style={styles.addLink}>+ Add item</Text></Pressable>}
          >
            <Text style={styles.hint}>Qty is required. Use 0 for delivery, VAT and fees.</Text>
            {!result.ocrError && !result.lineItems?.length ? (
              <View style={styles.ocrBanner}>
                <Text style={styles.ocrBannerText}>The scan couldn&apos;t read the line items. Type each item from the receipt.</Text>
              </View>
            ) : items.some((it) => it.ocr === "low") ? (
              <View style={styles.ocrBanner}>
                <Text style={styles.ocrBannerText}>Low OCR confidence: these items don&apos;t add up to the total. Check each one against the receipt.</Text>
              </View>
            ) : items.some((it) => it.ocr) ? (
              <View style={styles.ocrBanner}>
                <Text style={styles.ocrBannerText}>Read by the scan, which isn&apos;t always right. Check each item against the receipt.</Text>
              </View>
            ) : null}
            {items.map((item, index) => {
              const named = item.name.trim().length > 0;
              const qtyBad = named && toHundredths(item.quantity) === null;
              const amountBad = named && toCents(item.price) === null;
              return (
                <View key={item.id} style={[styles.itemCard, !!item.ocr && styles.itemCardOcr]}>
                  <View style={styles.itemTop}>
                    <View style={styles.itemLabelRow}>
                      <Text style={styles.itemIndex}>Item {index + 1}</Text>
                      {item.ocr && <Text style={styles.ocrBadge}>{item.ocr === "low" ? "Check — unsure" : "Check"}</Text>}
                    </View>
                    <Pressable onPress={() => removeItem(item.id)} hitSlop={8} accessibilityLabel={`Remove item ${index + 1}`}>
                      <Text style={styles.removeText}>Remove</Text>
                    </Pressable>
                  </View>
                  <TextInput style={styles.input} placeholder="Item name" placeholderTextColor={COLORS.muted} value={item.name} onChangeText={(v) => updateItem(item.id, { name: v, bomItemID: null })} />
                  {item.scanned && simpleText(item.scanned) !== simpleText(item.name) && (
                    <Text style={styles.scannedNote}>
                      Receipt says: &quot;{item.scanned}&quot;. The Project Manager will see this change.
                    </Text>
                  )}
                  {materials.length > 0 && (
                    <Pressable onPress={() => setPickingItemId(item.id)} style={({ pressed }) => [styles.pickButton, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`Choose a requested material for item ${index + 1}`}>
                      <Text style={styles.pickButtonText}>Choose from requested materials ▾</Text>
                    </Pressable>
                  )}
                  <View style={styles.itemRow}>
                    <View style={styles.itemQty}>
                      <Text style={styles.miniLabel}>Qty</Text>
                      <TextInput style={[styles.input, qtyBad && styles.inputError]} placeholder="0" placeholderTextColor={COLORS.muted} value={item.quantity} keyboardType="decimal-pad" onChangeText={(v) => editItem(item.id, "quantity", v)} />
                    </View>
                    <View style={styles.itemAmount}>
                      <Text style={styles.miniLabel}>Unit price (₱)</Text>
                      <TextInput style={styles.input} placeholder="Calculated" placeholderTextColor={COLORS.muted} value={item.unitPrice ?? ""} keyboardType="decimal-pad" onChangeText={(v) => editItem(item.id, "unitPrice", v)} onBlur={() => updateItem(item.id, { unitPrice: groupAmountText(item.unitPrice ?? "") })} />
                    </View>
                    <View style={styles.itemAmount}>
                      <Text style={styles.miniLabel}>Line amount (₱)</Text>
                      <TextInput style={[styles.input, amountBad && styles.inputError]} placeholder="0.00" placeholderTextColor={COLORS.muted} value={item.price} keyboardType="decimal-pad" onChangeText={(v) => editItem(item.id, "price", v)} onBlur={() => updateItem(item.id, { price: groupAmountText(item.price) })} />
                    </View>
                  </View>
                </View>
              );
            })}
          </Section>
        </ScrollView>

        <View style={styles.footer}>
          <Text style={[styles.totalsLine, { color: totalsMatch ? COLORS.success : RED }]}>
            Lines {formatPesoCents(linesCents)} of {totalCents === null ? "—" : formatPesoCents(totalCents)}
            {totalsMatch ? "  ✓" : ""}
          </Text>
          {fix && (
            <Pressable onPress={applyFix} style={({ pressed }) => [styles.fixButton, pressed && styles.pressed]} accessibilityRole="button">
              <Text style={styles.fixButtonText}>{fixLabel()}</Text>
              <Text style={styles.fixButtonHint}>A Project Manager will review the adjustment.</Text>
            </Pressable>
          )}
          <Pressable style={[styles.submitButton, !canContinue && styles.submitButtonDisabled]} onPress={handleContinue} accessibilityRole="button" accessibilityState={{ disabled: !canContinue }}>
            <Text style={styles.submitButtonText}>Looks correct — Continue</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <RequestedMaterialPicker
        visible={pickingItemId !== null}
        materials={materials}
        onClose={() => setPickingItemId(null)}
        onSelect={(m) => {
            if (pickingItemId) updateItem(pickingItemId, { name: m.name, bomItemID: m.bomItemID ?? null });
          setPickingItemId(null);
        }}
      />

      {file?.type === "image" && (
        <Modal visible={zoomOpen} transparent animationType="fade" onRequestClose={() => setZoomOpen(false)}>
          <Pressable style={styles.zoomBackdrop} onPress={() => setZoomOpen(false)} accessibilityLabel="Close the enlarged photo">
            <Image source={{ uri: file.uri }} style={styles.zoomImage} resizeMode="contain" />
            <Text style={styles.zoomHint}>Tap anywhere to close</Text>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

function VendorListBadge() {
  return <Text style={styles.vendorBadge}>From vendor list</Text>;
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  onBlur?: () => void;
  keyboardType?: "default" | "decimal-pad" | "numeric" | "numbers-and-punctuation";
  autoCapitalize?: "none" | "characters" | "words" | "sentences";
  placeholder?: string;
  lowConfidence?: boolean;
  lowHint?: string;
  fromVendorList?: boolean;
  error?: string | null;
};

function Field({ label, value, onChangeText, onBlur, keyboardType, autoCapitalize, placeholder, lowConfidence, lowHint, fromVendorList, error }: FieldProps) {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {fromVendorList && <VendorListBadge />}
      </View>
      <TextInput
        style={[styles.input, lowConfidence && styles.inputLow, !!error && styles.inputError]}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        placeholder={placeholder ?? "—"}
        placeholderTextColor={COLORS.muted}
      />
      {error ? (
        <Text style={styles.errorHint}>{error}</Text>
      ) : lowConfidence ? (
        <Text style={styles.lowHint}>{lowHint ?? "Low OCR confidence — check this against the receipt."}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  thumbRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 10, marginBottom: 10 },
  thumb: { width: 56, height: 72, borderRadius: 8, backgroundColor: COLORS.bg },
  thumbPdf: { alignItems: "center", justifyContent: "center" },
  thumbName: { fontSize: 14, fontWeight: "700", color: COLORS.heading },
  thumbHint: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  birBadge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, marginBottom: 10 },
  birFormal: { backgroundColor: COLORS.successBg },
  birInformal: { backgroundColor: AMBER_BG },
  birText: { fontSize: 12, fontWeight: "700" },
  birNote: { fontSize: 12, color: COLORS.muted, marginTop: -4, marginBottom: 10 },
  warnBox: { backgroundColor: AMBER_BG, borderRadius: 12, padding: 12, marginBottom: 10, gap: 4 },
  warnTitle: { fontSize: 13, fontWeight: "800", color: AMBER },
  warnLine: { fontSize: 12, color: AMBER },
  section: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 14, marginBottom: 12 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: COLORS.heading },
  field: { marginBottom: 12 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: COLORS.muted },
  vendorBadge: { fontSize: 11, fontWeight: "700", color: COLORS.success, backgroundColor: COLORS.successBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  input: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: COLORS.heading },
  dateInput: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dateText: { fontSize: 15, color: COLORS.heading },
  inputLow: { borderColor: AMBER, backgroundColor: "#FFFBEB" },
  inputError: { borderColor: RED },
  lowHint: { fontSize: 11, color: AMBER, marginTop: 4 },
  errorHint: { fontSize: 11, color: RED, marginTop: 4 },
  addLink: { fontSize: 13, fontWeight: "700", color: COLORS.success },
  hint: { fontSize: 11, color: COLORS.muted, marginBottom: 8 },
  pickButton: { alignSelf: "flex-start", borderWidth: 1, borderColor: COLORS.primary, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  pickButtonText: { fontSize: 12, fontWeight: "600", color: COLORS.primary },
  scannedNote: { fontSize: 12, color: AMBER, marginTop: 4 },
  itemLabelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  itemCardOcr: { borderColor: AMBER, backgroundColor: "#FFFBEB" },
  ocrBadge: { fontSize: 10, fontWeight: "700", color: AMBER, backgroundColor: AMBER_BG, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8, overflow: "hidden" },
  rejectBox: { backgroundColor: "#FEE2E2", borderRadius: 10, padding: 12, marginBottom: 12, gap: 4 },
  rejectTitle: { fontSize: 13, fontWeight: "700", color: "#C1121F" },
  rejectReason: { fontSize: 13, color: "#7F1D1D", fontStyle: "italic" },
  rejectHint: { fontSize: 12, color: "#7F1D1D" },
  ocrBanner: { backgroundColor: AMBER_BG, borderRadius: 10, padding: 10, marginBottom: 10 },
  ocrBannerText: { fontSize: 12, color: AMBER },
  itemCard: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 10, marginBottom: 10, gap: 8, backgroundColor: COLORS.bg },
  itemTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  itemIndex: { fontSize: 12, fontWeight: "700", color: COLORS.muted },
  removeText: { fontSize: 12, fontWeight: "700", color: RED },
  itemRow: { flexDirection: "row", gap: 10 },
  itemQty: { flex: 1 },
  itemAmount: { flex: 2 },
  miniLabel: { fontSize: 11, color: COLORS.muted, marginBottom: 4 },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.bg },
  totalsLine: { fontSize: 13, fontWeight: "700", textAlign: "center", marginBottom: 8 },
  fixButton: { borderWidth: 1, borderColor: AMBER, backgroundColor: AMBER_BG, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, alignItems: "center", marginBottom: 8 },
  fixButtonText: { fontSize: 14, fontWeight: "700", color: AMBER },
  fixButtonHint: { fontSize: 11, color: AMBER, marginTop: 2 },
  pressed: { opacity: 0.85 },
  zoomBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center", padding: 12 },
  zoomImage: { width: "100%", height: "88%" },
  zoomHint: { color: "rgba(255,255,255,0.8)", fontSize: 13, marginTop: 10 },
  submitButton: { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: "#FFF", fontWeight: "700", fontSize: 16 },
});
