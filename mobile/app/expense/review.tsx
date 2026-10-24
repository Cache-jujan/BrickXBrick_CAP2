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
import { useLocale } from "@/lib/i18n-context";

const RED = COLORS.errorText;
const AMBER = COLORS.amberText;
const AMBER_BG = COLORS.amberBannerFill;

// Our field name -> the key the parser uses in `confidence`.
const CONFIDENCE_KEY: Record<string, string> = {
  vendorName: "vendorName", tin: "tin", birPermitNumber: "birPermitNumber",
  birNumber: "orSiNumber", amount: "amount", receiptDate: "date",
};
const FIELD_LABEL: Record<string, string> = { tin: "TIN", birPermitNumber: "BIR permit" };
// The Field component compares its error to this to show the red "Required" tag.
const REQUIRED = "__required__";

function makeId() { return Math.random().toString(36).slice(2, 10); }
// Case, spacing and punctuation don't count as renaming a line.
function simpleText(text: string) { return text.toLowerCase().replace(/[^a-z0-9]+/g, ""); }

/** Review and correct scanned receipt fields and totals before ticket linking or allocation. */
export default function ReviewScreen() {
  const { t, intlLocale } = useLocale();
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
            detail: t("rv.material_detail", { project: r.projectName, qty: r.remainingQuantity, subject: r.subject }),
            bomItemID: r.bomItemID ?? null,
          }))
        );
      })
      // The picker is a shortcut; without it the user types the names.
      .catch((err) => devLog("Couldn't load requested materials:", err?.message ?? err));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the ticket changes, not on a language change
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
  const dateProblem = receiptDateProblem(receiptDate, t);
  const vendorMissing = vendorName.trim().length === 0;
  const canContinue = allLinesValid && totalsMatch && !dateProblem && !vendorMissing;
  // Everything still blocking Continue. Shown above the button once the user
  // has tapped it, next to the red outlines on the fields themselves.
  const blockedReasons = [
    vendorMissing && t("rv.err_vendor"),
    dateProblem,
    namedItems.length === 0 && t("rv.err_add_item"),
    namedItems.length > 0 && !allLinesValid && t("rv.err_lines"),
    totalCents === null && t("rv.err_total"),
    allLinesValid && totalCents !== null && !totalsMatch && t("rv.err_match"),
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
    return fix.kind === "add" ? t("rv.fix_add", { gap }) : t("rv.fix_discount", { gap, item: fix.itemName });
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
    if (vendorMissing) return Alert.alert(t("rv.vendor_required"), t("rv.err_vendor"));
    if (dateProblem) return Alert.alert(t("rv.check_date"), dateProblem);
    if (namedItems.length === 0) return Alert.alert(t("rv.add_one_title"), t("rv.add_one_body"));
    if (!allLinesValid) return Alert.alert(t("rv.check_lines"), t("rv.check_lines_body"));
    if (!totalsMatch) {
      if (!fix) return Alert.alert(t("rv.totals_mismatch"), t("rv.totals_body"));
      return Alert.alert(
        t("rv.totals_mismatch"),
        t(fix.kind === "add" ? "rv.totals_gap_short" : "rv.totals_gap_over", { gap: formatPesoCents(fix.gapCents) }),
        [{ text: t("rv.check_again"), style: "cancel" }, { text: fixLabel(), onPress: applyFix }]
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
    if (!url) return Alert.alert(t("rv.cant_open_pdf"), t("rv.pdf_not_uploaded"));
    Linking.openURL(url).catch(() => Alert.alert(t("rv.cant_open_pdf"), t("rv.no_pdf_app")));
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlowHeader title={t("mx.review_receipt")} caption={isSplit ? t("mx.split_step", { current: 2, total: 3 }) : t("mx.step_n", { current: 2, total: 3 })} step={{ current: 2, total: 3 }} />
      <KeyboardAvoider style={styles.flex}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {draft.resubmit && (
            <View style={styles.rejectBox}>
              <Text style={styles.rejectTitle}>{t("rv.rejected_title")}</Text>
              <Text style={styles.rejectReason}>{draft.resubmit.reason ? `"${draft.resubmit.reason}"` : t("rv.no_reason")}</Text>
              <Text style={styles.rejectHint}>{t("rv.fix_hint")}</Text>
            </View>
          )}

          {file && (
            <Pressable
              onPress={openReceiptFile}
              style={({ pressed }) => [styles.thumbRow, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={file.type === "image" ? t("rv.file_aria_image") : t("rv.file_aria_pdf")}
            >
              {file.type === "image" ? (
                <Image source={{ uri: file.uri }} style={styles.thumb} resizeMode="cover" />
              ) : (
                <View style={[styles.thumb, styles.thumbPdf]}><IconSymbol name="doc.fill" size={26} color={COLORS.errorText} /></View>
              )}
              <View style={styles.flex}>
                <Text style={styles.thumbTitle}>{t("rv.receipt_file")}</Text>
                <Text style={styles.thumbName} numberOfLines={1}>{file.name}{file.type === "pdf" && file.size ? ` · ${file.size}` : ""}</Text>
                <Text style={styles.thumbHint}>{t("rv.tap_open")}</Text>
              </View>
            </Pressable>
          )}

          {hasChecks || !bir.formal ? (
            <View style={styles.banner}>
              <IconSymbol name="exclamationmark.triangle.fill" size={18} color={COLORS.amberText} />
              <View style={styles.flex}>
                <Text style={styles.bannerTitle}>{hasChecks ? t("rv.check_amber") : t("rv.informal")}</Text>
                {hasChecks && (
                  <Text style={styles.bannerText}>
                    {readNoItems ? t("rv.no_items_read") : t("rv.not_sure")}
                  </Text>
                )}
                {!bir.formal && (
                  <Text style={styles.bannerText}>
                    {t("rv.informal_note", { missing: bir.missing.join(` ${t("mx.or")} `) })}
                  </Text>
                )}
              </View>
            </View>
          ) : (
            <View style={[styles.birBadge, styles.birFormal]}>
              <IconSymbol name="checkmark.seal.fill" size={16} color={COLORS.success} />
              <Text style={[styles.birText, { color: COLORS.success }]}>{t("rv.formal")}</Text>
            </View>
          )}

          {conflicts.length > 0 && (
            <View style={styles.warnBox}>
              <Text style={styles.warnTitle}>{t("submit.conflict_title")}</Text>
              {conflicts.map((c) => (
                <Text key={c.field} style={styles.warnLine}>
                  {t("submit.conflict", { field: FIELD_LABEL[c.field] ?? c.field, ocr: c.ocrValue ?? "", master: c.masterValue ?? "" })}
                </Text>
              ))}
              <Text style={styles.warnLine}>{t("rv.vendor_list_filled")}</Text>
            </View>
          )}

          <Section title={t("rv.section_vendor")}>
            <Field label={t("dashboard.vendor")} value={vendorName} onChangeText={edit("vendorName", setVendorName)} check={isLowConfidence("vendorName")} error={vendorMissing ? REQUIRED : null} />
            <View style={styles.pair}>
              <Field style={styles.half} label="TIN" value={tin} onChangeText={edit("tin", setTin)} keyboardType="numbers-and-punctuation" check={isLowConfidence("tin")} fromVendorList={autoFilled.includes("tin")} />
              <Field style={styles.half} label={t("rv.bir_permit")} value={birPermitNumber} onChangeText={edit("birPermitNumber", setBirPermitNumber)} autoCapitalize="characters" check={isLowConfidence("birPermitNumber")} fromVendorList={autoFilled.includes("birPermitNumber")} />
            </View>
            <Field label="OR / SI number" value={birNumber} onChangeText={edit("birNumber", setBirNumber)} autoCapitalize="characters" check={isLowConfidence("birNumber")} />
          </Section>

          <Section title={t("rv.section_amount")}>
            <View style={styles.pair}>
              <Field style={styles.half} label={t("rv.total_php")} value={amount} onChangeText={edit("amount", setAmount)} onBlur={() => setAmount(groupAmountText)} keyboardType="decimal-pad" check={ocrCheck("amount") !== null} error={totalCents === null ? t("rv.enter_total") : null} />
              {Platform.OS === "web" ? (
                // The native picker has no web build, so the web preview keeps a typed date.
                <Field style={styles.half} label={t("dashboard.date")} value={receiptDate} onChangeText={edit("receiptDate", setReceiptDate)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" check={isLowConfidence("receiptDate")} error={dateProblem} />
              ) : (
                <View style={[styles.field, styles.half]}>
                  <View style={styles.labelRow}>
                    <Text style={styles.fieldLabel}>{t("dashboard.date")}</Text>
                    {isLowConfidence("receiptDate") && <Text style={styles.checkTag}>{t("rv.check_tag")}</Text>}
                  </View>
                  <Pressable
                    onPress={openDatePicker}
                    style={[styles.input, styles.dateInput, isLowConfidence("receiptDate") && styles.inputLow, !!dateProblem && styles.inputError]}
                    accessibilityRole="button"
                    accessibilityLabel={t("rv.date_aria", { date: formatReceiptDate(receiptDate, intlLocale) })}
                  >
                    <Text style={styles.dateText} numberOfLines={1}>{formatReceiptDate(receiptDate, intlLocale)}</Text>
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
              <Text style={styles.lowHint}>{t("rv.no_date_today")}</Text>
            ) : null}
          </Section>

          <Section
            title={t("rv.line_items", { count: items.length })}
            action={<Pressable onPress={addItem} hitSlop={8} style={styles.addButton} accessibilityRole="button"><Text style={styles.addLink}>+ {t("common.add_item")}</Text></Pressable>}
          >
            <Text style={styles.hint}>{t("rv.qty_hint")}</Text>
            {items.map((item, index) => {
              const named = item.name.trim().length > 0;
              const qtyBad = named && toHundredths(item.quantity) === null;
              const amountBad = named && toCents(item.price) === null;
              return (
                <View key={item.id} style={[styles.itemCard, !!item.ocr && styles.itemCardOcr]}>
                  <View style={styles.itemTop}>
                    <View style={styles.itemLabelRow}>
                      <Text style={styles.itemIndex}>{t("submit.item_n", { n: index + 1 })}</Text>
                      {item.ocr && <Text style={styles.checkTag}>{t("rv.check_tag")}</Text>}
                    </View>
                    <Pressable onPress={() => removeItem(item.id)} hitSlop={8} style={styles.removeButton} accessibilityRole="button" accessibilityLabel={t("submit.remove_item_n", { n: index + 1 })}>
                      <Text style={styles.removeText}>{t("common.remove")}</Text>
                    </Pressable>
                  </View>
                  <TextInput style={styles.input} placeholder={t("rv.item_name_ph")} placeholderTextColor={COLORS.muted} value={item.name} onChangeText={(v) => updateItem(item.id, { name: v, bomItemID: null })} />
                  {item.scanned && simpleText(item.scanned) !== simpleText(item.name) && (
                    <Text style={styles.scannedNote}>
                      {t("rv.receipt_says", { scanned: item.scanned })}
                    </Text>
                  )}
                  {materials.length > 0 && (
                    <Pressable onPress={() => setPickingItemId(item.id)} style={({ pressed }) => [styles.pickButton, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={t("rv.pick_aria", { n: index + 1 })}>
                      <Text style={styles.pickButtonText}>{t("rv.match_material")}</Text>
                      <IconSymbol name="chevron.right" size={18} color={COLORS.muted} />
                    </Pressable>
                  )}
                  <View style={styles.itemRow}>
                    <View style={styles.itemQty}>
                      <Text style={styles.miniLabel}>{t("split.col_qty")}</Text>
                      <TextInput style={[styles.input, qtyBad && styles.inputError]} placeholder="0" placeholderTextColor={COLORS.muted} value={item.quantity} keyboardType="decimal-pad" onChangeText={(v) => editItem(item.id, "quantity", v)} />
                    </View>
                    <View style={styles.itemAmount}>
                      <Text style={styles.miniLabel}>{t("submit.unit_price")}</Text>
                      <TextInput style={styles.input} placeholder={t("submit.calculated")} placeholderTextColor={COLORS.muted} value={item.unitPrice ?? ""} keyboardType="decimal-pad" onChangeText={(v) => editItem(item.id, "unitPrice", v)} onBlur={() => updateItem(item.id, { unitPrice: groupAmountText(item.unitPrice ?? "") })} />
                    </View>
                    <View style={styles.itemAmount}>
                      <Text style={styles.miniLabel}>{t("rv.line_amount")}</Text>
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
              {t("rv.lines_of", { lines: formatPesoCents(linesCents), total: totalCents === null ? "—" : formatPesoCents(totalCents) })}
            </Text>
          </View>
          {fix && (
            <Pressable onPress={applyFix} style={({ pressed }) => [styles.fixButton, pressed && styles.pressed]} accessibilityRole="button">
              <Text style={styles.fixButtonText}>{fixLabel()}</Text>
              <Text style={styles.fixButtonHint}>{t("rv.fix_hint2")}</Text>
            </Pressable>
          )}
          {triedContinue && <BlockedReasons reasons={blockedReasons} />}
          <Pressable style={[styles.submitButton, !canContinue && styles.submitButtonDisabled]} onPress={handleContinue} accessibilityRole="button" accessibilityState={{ disabled: !canContinue }}>
            <Text style={styles.submitButtonText}>{t("rv.continue")}</Text>
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
          <Pressable style={styles.zoomBackdrop} onPress={() => setZoomOpen(false)} accessibilityLabel={t("rv.close_photo")}>
            <Image source={{ uri: file.uri }} style={styles.zoomImage} resizeMode="contain" />
            <Text style={styles.zoomHint}>{t("rv.tap_close")}</Text>
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
  const { t } = useLocale();
  return <Text style={styles.vendorBadge}>{t("rv.from_vendor_list")}</Text>;
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
  const { t } = useLocale();
  const required = error === REQUIRED;
  return (
    <View style={[styles.field, style]}>
      <View style={styles.labelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {required ? <Text style={styles.requiredTag}>{t("mx.required_tag")}</Text> : fromVendorList ? <VendorListBadge /> : check ? <Text style={styles.checkTag}>{t("rv.check_tag")}</Text> : null}
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
