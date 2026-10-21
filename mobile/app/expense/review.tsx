import React, { useEffect, useState } from "react";
import {
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";

import { FlowHeader } from "@/components/flow-header";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { RequestedMaterialPicker, type RequestedMaterial } from "@/components/requested-material-picker";
import { useExpenseDraft } from "@/lib/expense-draft-context";
import { editLine, unitPriceForPayload, withUnitPrice } from "@/lib/line-math";
import type { LineItem } from "@/lib/expense-types";
import { COLORS, FONT } from "@/constants/expense-flow-colors";
import { formatAmountInput, formatPesoCents, groupAmountText, toCents, toHundredths } from "@/lib/money";
import { devLog } from "@/lib/sync/log";
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
import { loadOpenRequests } from "@/lib/cached-api";
import { BlockedReasons } from "@/components/blocked-reasons";
import { phoneReachableUrl } from "@/lib/receipt-scans";
import { KeyboardAvoider } from "@/components/keyboard-avoider";

const RED = COLORS.errorText;
const AMBER = COLORS.amberText;
const AMBER_BG = COLORS.amberBannerFill;

// Our field name -> the key the parser uses in `confidence`.
const CONFIDENCE_KEY: Record<string, string> = {
  vendorName: "vendorName", tin: "tin", birPermitNumber: "birPermitNumber",
  birNumber: "orSiNumber", amount: "amount", receiptDate: "date",
};
const FIELD_LABEL: Record<string, string> = { tin: "TIN", birPermitNumber: "BIR permit" };

function makeId() { return Math.random().toString(36).slice(2, 10); }
// Case, spacing and punctuation don't count as renaming a line.
function simpleText(text: string) { return text.toLowerCase().replace(/[^a-z0-9]+/g, ""); }

/** Review and correct scanned receipt fields and totals before ticket linking or allocation. */
export default function ReviewScreen() {
  const { draft, setOcrResult } = useExpenseDraft();
  const result = draft.ocrResult;

  const [triedContinue, setTriedContinue] = useState(false);
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
    loadOpenRequests()
      .then(({ data: requests }) => {
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
      .catch((err) => devLog("Couldn't load requested materials:", err?.message ?? err));
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
  // Everything still blocking Continue. Shown above the button once the user
  // has tapped it, next to the red outlines on the fields themselves.
  const blockedReasons = [
    vendorMissing && "Enter the store or vendor name.",
    dateProblem,
    namedItems.length === 0 && "Add at least one item.",
    namedItems.length > 0 && !allLinesValid && "Every item needs a quantity and an amount (use 0 for delivery, VAT and fees).",
    totalCents === null && "Enter the receipt total.",
    allLinesValid && totalCents !== null && !totalsMatch && "The items must add up to the receipt total.",
  ];
  const bir = birStatusPreview({ tin, birPermitNumber, birNumber });
  // One-tap way out when the lines won't add up (rounding, unlisted VAT or
  // discount). The adjustment line routes the expense to PM review.
  const fix = allLinesValid && !totalsMatch
    ? reconcileFix(totalCents, namedItems.map((it) => ({ id: it.id, name: it.name.trim(), cents: toCents(it.price) })))
    : null;

  // Any edit counts as the user checking that row, so its OCR flag goes.
  function updateItem(id: string, patch: Partial<LineItem>) { setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch, ocr: undefined } : it))); }
  /** Synchronize a line's numeric fields and clear its OCR warning after an edit. */
  function editItem(id: string, field: "quantity" | "price" | "unitPrice", value: string) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...editLine(it, field, value), ocr: undefined } : it)));
  }
  function removeItem(id: string) { setItems((prev) => prev.filter((it) => it.id !== id)); }
  function addItem() { setItems((prev) => [...prev, { id: makeId(), name: "", quantity: "", price: "" }]); }

  /** Reconcile totals by adding an adjustment or applying a discount with a review note. */
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

  /** Validate receipt fields and totals, save corrected values and open the next flow step. */
  function handleContinue() {
    setTriedContinue(true);
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

  // Anything the scan wasn't sure about. One banner covers all of it, so no
  // field repeats a warning of its own: each just gets a small "Check" tag.
  const readNoItems = !result.ocrError && !result.lineItems?.length;
  const hasChecks = readNoItems
    || ocrCheck("amount") !== null
    || ["vendorName", "tin", "birPermitNumber", "birNumber", "receiptDate"].some((f) => isLowConfidence(f))
    || items.some((it) => it.ocr);

  // A photo opens in the viewer. A PDF opens from its uploaded link, since the
  // phone's PDF apps can't read our private cache file.
  function openReceiptFile() {
    if (!file) return;
    if (file.type === "image") return setZoomOpen(true);
    const url = result?.receiptImageURL ? phoneReachableUrl(result.receiptImageURL) : null;
    if (!url) return Alert.alert("Can't open the PDF", "The file isn't uploaded yet. Go back and scan it again.");
    Linking.openURL(url).catch(() => Alert.alert("Can't open the PDF", "No app on this phone could open it."));
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlowHeader title="Review receipt" caption={isSplit ? "Split receipt · Step 2 of 3" : "Step 2 of 3"} step={{ current: 2, total: 3 }} />
      <KeyboardAvoider style={styles.flex}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {draft.resubmit && (
            <View style={styles.rejectBox}>
              <Text style={styles.rejectTitle}>Your Project Manager rejected this expense</Text>
              <Text style={styles.rejectReason}>{draft.resubmit.reason ? `"${draft.resubmit.reason}"` : "No reason was given."}</Text>
              <Text style={styles.rejectHint}>Fix what they pointed out, then resubmit.</Text>
            </View>
          )}

          {file && (
            <Pressable
              onPress={openReceiptFile}
              style={({ pressed }) => [styles.thumbRow, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={file.type === "image" ? "Receipt file. Tap to enlarge the photo." : "Receipt file. Tap to open the PDF."}
            >
              {file.type === "image" ? (
                <Image source={{ uri: file.uri }} style={styles.thumb} resizeMode="cover" />
              ) : (
                <View style={[styles.thumb, styles.thumbPdf]}><IconSymbol name="doc.fill" size={26} color={COLORS.errorText} /></View>
              )}
              <View style={styles.flex}>
                <Text style={styles.thumbTitle}>Receipt file</Text>
                <Text style={styles.thumbName} numberOfLines={1}>{file.name}{file.type === "pdf" && file.size ? ` · ${file.size}` : ""}</Text>
                <Text style={styles.thumbHint}>Tap to open. Compare each value with the paper receipt.</Text>
              </View>
            </Pressable>
          )}

          {hasChecks || !bir.formal ? (
            <View style={styles.banner}>
              <IconSymbol name="exclamationmark.triangle.fill" size={18} color={COLORS.amberText} />
              <View style={styles.flex}>
                <Text style={styles.bannerTitle}>{hasChecks ? "Check the amber fields" : "Informal receipt"}</Text>
                {hasChecks && (
                  <Text style={styles.bannerText}>
                    {readNoItems
                      ? "The scan couldn't read the line items, so type each one from the receipt. "
                      : "The scan was not sure about these. Compare each one with the paper receipt. "}
                  </Text>
                )}
                {!bir.formal && (
                  <Text style={styles.bannerText}>
                    No {bir.missing.join(" or ")} entered. It is an informal receipt: still OK to submit, but it won&apos;t count as tax-deductible. Fill them in if the paper shows them.
                  </Text>
                )}
              </View>
            </View>
          ) : (
            <View style={[styles.birBadge, styles.birFormal]}>
              <IconSymbol name="checkmark.seal.fill" size={16} color={COLORS.success} />
              <Text style={[styles.birText, { color: COLORS.success }]}>Formal · tax-deductible</Text>
            </View>
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
            <Field label="Vendor" value={vendorName} onChangeText={edit("vendorName", setVendorName)} check={isLowConfidence("vendorName")} error={vendorMissing ? "Required" : null} />
            <View style={styles.pair}>
              <Field style={styles.half} label="TIN" value={tin} onChangeText={edit("tin", setTin)} keyboardType="numbers-and-punctuation" check={isLowConfidence("tin")} fromVendorList={autoFilled.includes("tin")} />
              <Field style={styles.half} label="BIR permit" value={birPermitNumber} onChangeText={edit("birPermitNumber", setBirPermitNumber)} autoCapitalize="characters" check={isLowConfidence("birPermitNumber")} fromVendorList={autoFilled.includes("birPermitNumber")} />
            </View>
            <Field label="OR / SI number" value={birNumber} onChangeText={edit("birNumber", setBirNumber)} autoCapitalize="characters" check={isLowConfidence("birNumber")} />
          </Section>

          <Section title="Amount & date">
            <View style={styles.pair}>
              <Field style={styles.half} label="Total (₱)" value={amount} onChangeText={edit("amount", setAmount)} onBlur={() => setAmount(groupAmountText)} keyboardType="decimal-pad" check={ocrCheck("amount") !== null} error={totalCents === null ? "Enter the total" : null} />
              {Platform.OS === "web" ? (
                // The native picker has no web build, so the web preview keeps a typed date.
                <Field style={styles.half} label="Date" value={receiptDate} onChangeText={edit("receiptDate", setReceiptDate)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" check={isLowConfidence("receiptDate")} error={dateProblem} />
              ) : (
                <View style={[styles.field, styles.half]}>
                  <View style={styles.labelRow}>
                    <Text style={styles.fieldLabel}>Date</Text>
                    {isLowConfidence("receiptDate") && <Text style={styles.checkTag}>Check</Text>}
                  </View>
                  <Pressable
                    onPress={openDatePicker}
                    style={[styles.input, styles.dateInput, isLowConfidence("receiptDate") && styles.inputLow, !!dateProblem && styles.inputError]}
                    accessibilityRole="button"
                    accessibilityLabel={`Receipt date, ${formatReceiptDate(receiptDate)}. Tap to change.`}
                  >
                    <Text style={styles.dateText} numberOfLines={1}>{formatReceiptDate(receiptDate)}</Text>
                    <IconSymbol name="calendar" size={18} color={COLORS.muted} />
                  </Pressable>
                </View>
              )}
            </View>
            {iosDateOpen && Platform.OS !== "web" && (
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
            {dateProblem && Platform.OS !== "web" ? <Text style={styles.errorHint}>{dateProblem}</Text> : null}
            {!result.receiptDate && isLowConfidence("receiptDate") && Platform.OS !== "web" ? (
              <Text style={styles.lowHint}>No date was read, so it is set to today. Tap to change it.</Text>
            ) : null}
          </Section>

          <Section
            title={`Line items (${items.length})`}
            action={<Pressable onPress={addItem} hitSlop={8} style={styles.addButton} accessibilityRole="button"><Text style={styles.addLink}>+ Add item</Text></Pressable>}
          >
            <Text style={styles.hint}>Qty is required. Use 0 for delivery, VAT and fees.</Text>
            {items.map((item, index) => {
              const named = item.name.trim().length > 0;
              const qtyBad = named && toHundredths(item.quantity) === null;
              const amountBad = named && toCents(item.price) === null;
              return (
                <View key={item.id} style={[styles.itemCard, !!item.ocr && styles.itemCardOcr]}>
                  <View style={styles.itemTop}>
                    <View style={styles.itemLabelRow}>
                      <Text style={styles.itemIndex}>Item {index + 1}</Text>
                      {item.ocr && <Text style={styles.checkTag}>Check</Text>}
                    </View>
                    <Pressable onPress={() => removeItem(item.id)} hitSlop={8} style={styles.removeButton} accessibilityRole="button" accessibilityLabel={`Remove item ${index + 1}`}>
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
                      <Text style={styles.pickButtonText}>Match to a requested material</Text>
                      <IconSymbol name="chevron.right" size={18} color={COLORS.muted} />
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
          <View style={styles.totalsRow}>
            {totalsMatch && <IconSymbol name="checkmark.circle.fill" size={16} color={COLORS.success} />}
            <Text style={[styles.totalsLine, { color: totalsMatch ? COLORS.success : RED }]}>
              Lines {formatPesoCents(linesCents)} of {totalCents === null ? "—" : formatPesoCents(totalCents)}
            </Text>
          </View>
          {fix && (
            <Pressable onPress={applyFix} style={({ pressed }) => [styles.fixButton, pressed && styles.pressed]} accessibilityRole="button">
              <Text style={styles.fixButtonText}>{fixLabel()}</Text>
              <Text style={styles.fixButtonHint}>A Project Manager will review the adjustment.</Text>
            </Pressable>
          )}
          {triedContinue && <BlockedReasons reasons={blockedReasons} />}
          <Pressable style={[styles.submitButton, !canContinue && styles.submitButtonDisabled]} onPress={handleContinue} accessibilityRole="button" accessibilityState={{ disabled: !canContinue }}>
            <Text style={styles.submitButtonText}>Looks correct, continue</Text>
          </Pressable>
        </View>
      </KeyboardAvoider>

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
  // The scan wasn't sure about this value: amber field and a "Check" tag.
  check?: boolean;
  fromVendorList?: boolean;
  error?: string | null;
  style?: StyleProp<ViewStyle>;
};

function Field({ label, value, onChangeText, onBlur, keyboardType, autoCapitalize, placeholder, check, fromVendorList, error, style }: FieldProps) {
  const required = error === "Required";
  return (
    <View style={[styles.field, style]}>
      <View style={styles.labelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {required ? <Text style={styles.requiredTag}>Required</Text> : fromVendorList ? <VendorListBadge /> : check ? <Text style={styles.checkTag}>Check</Text> : null}
      </View>
      <TextInput
        style={[styles.input, check && !error && styles.inputLow, !!error && styles.inputError, required && styles.inputRequired]}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        placeholder={placeholder ?? "—"}
        placeholderTextColor={COLORS.muted}
      />
      {error && !required ? <Text style={styles.errorHint}>{error}</Text> : null}
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
  thumbTitle: { fontSize: 14, fontFamily: FONT.extrabold, color: COLORS.heading },
  thumbName: { fontSize: 12, fontFamily: FONT.medium, color: COLORS.heading, marginTop: 1 },
  thumbHint: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 2 },
  banner: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: COLORS.amberBannerFill, borderWidth: 1, borderColor: COLORS.amberBorder, borderRadius: 14, padding: 12, marginBottom: 10 },
  bannerTitle: { fontSize: 14, fontFamily: FONT.extrabold, color: COLORS.amberBannerText },
  bannerText: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.amberBannerText, lineHeight: 18, marginTop: 2 },
  pair: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
  checkTag: { fontSize: 11, fontFamily: FONT.bold, color: COLORS.amberText, backgroundColor: COLORS.amberBannerFill, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8, overflow: "hidden" },
  requiredTag: { fontSize: 11, fontFamily: FONT.bold, color: COLORS.errorText },
  inputRequired: { backgroundColor: COLORS.errorFill, borderWidth: 1.5 },
  addButton: { minHeight: 44, justifyContent: "center", paddingLeft: 8 },
  removeButton: { minHeight: 44, justifyContent: "center", paddingLeft: 12 },
  totalsRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 8 },
  birBadge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, marginBottom: 10 },
  birFormal: { backgroundColor: COLORS.successBg },
  birInformal: { backgroundColor: AMBER_BG },
  birText: { fontSize: 12, fontFamily: FONT.bold },
  birNote: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, marginTop: -4, marginBottom: 10 },
  warnBox: { backgroundColor: AMBER_BG, borderRadius: 12, padding: 12, marginBottom: 10, gap: 4 },
  warnTitle: { fontSize: 13, fontFamily: FONT.extrabold, color: AMBER },
  warnLine: { fontSize: 12, fontFamily: FONT.regular, color: AMBER },
  section: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 14, marginBottom: 12 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontFamily: FONT.extrabold, color: COLORS.heading },
  field: { marginBottom: 12 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  fieldLabel: { fontSize: 12, fontFamily: FONT.semibold, color: COLORS.muted },
  vendorBadge: { fontSize: 11, fontFamily: FONT.bold, color: COLORS.success, backgroundColor: COLORS.successBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  input: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 12, paddingHorizontal: 12, minHeight: 44, paddingVertical: 10, fontSize: 15, fontFamily: FONT.regular, color: COLORS.heading },
  dateInput: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dateText: { fontSize: 15, fontFamily: FONT.regular, color: COLORS.heading },
  inputLow: { borderColor: COLORS.amberBorder, backgroundColor: COLORS.amberFill },
  inputError: { borderColor: RED },
  lowHint: { fontSize: 11, fontFamily: FONT.regular, color: AMBER, marginTop: 4 },
  errorHint: { fontSize: 11, fontFamily: FONT.regular, color: RED, marginTop: 4 },
  addLink: { fontSize: 13, fontFamily: FONT.bold, color: COLORS.success },
  hint: { fontSize: 11, fontFamily: FONT.regular, color: COLORS.muted, marginBottom: 8 },
  pickButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 12, paddingHorizontal: 12, backgroundColor: COLORS.card },
  pickButtonText: { fontSize: 14, fontFamily: FONT.medium, color: COLORS.muted },
  scannedNote: { fontSize: 12, fontFamily: FONT.regular, color: AMBER, marginTop: 4 },
  itemLabelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  itemCardOcr: { borderColor: COLORS.amberBorder, backgroundColor: COLORS.amberFill },
  ocrBadge: { fontSize: 10, fontFamily: FONT.bold, color: AMBER, backgroundColor: AMBER_BG, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8, overflow: "hidden" },
  rejectBox: { backgroundColor: COLORS.errorFill, borderRadius: 10, padding: 12, marginBottom: 12, gap: 4 },
  rejectTitle: { fontSize: 13, fontFamily: FONT.bold, color: COLORS.errorText },
  rejectReason: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.errorText, fontStyle: "italic" },
  rejectHint: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.errorText },
  ocrBanner: { backgroundColor: AMBER_BG, borderRadius: 10, padding: 10, marginBottom: 10 },
  ocrBannerText: { fontSize: 12, fontFamily: FONT.regular, color: AMBER },
  itemCard: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 10, marginBottom: 10, gap: 8, backgroundColor: COLORS.bg },
  itemTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  itemIndex: { fontSize: 12, fontFamily: FONT.bold, color: COLORS.muted },
  removeText: { fontSize: 12, fontFamily: FONT.bold, color: RED },
  itemRow: { flexDirection: "row", gap: 10 },
  itemQty: { flex: 1 },
  itemAmount: { flex: 2 },
  miniLabel: { fontSize: 11, fontFamily: FONT.regular, color: COLORS.muted, marginBottom: 4 },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.bg },
  totalsLine: { fontSize: 13, fontFamily: FONT.bold, textAlign: "center" },
  fixButton: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: AMBER, backgroundColor: AMBER_BG, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, alignItems: "center", marginBottom: 8 },
  fixButtonText: { fontSize: 14, fontFamily: FONT.bold, color: AMBER },
  fixButtonHint: { fontSize: 11, fontFamily: FONT.regular, color: AMBER, marginTop: 2 },
  pressed: { opacity: 0.85 },
  zoomBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center", padding: 12 },
  zoomImage: { width: "100%", height: "88%" },
  zoomHint: { color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: FONT.regular, marginTop: 10 },
  submitButton: { minHeight: 48, backgroundColor: COLORS.primary, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: "#FFF", fontFamily: FONT.bold, fontSize: 16 },
});
