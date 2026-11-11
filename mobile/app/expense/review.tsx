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
import { formatAmountInput, formatPesoCents, groupAmountLive, groupAmountText, toCents, toHundredths } from "@/lib/money";
import { devLog } from "@/lib/sync/log";
import {
  birStatusPreview,
  dateToIso,
  formatReceiptDate,
  isoToDate,
  receiptDateProblem,
  todayIso,
} from "@/lib/receipt-checks";
import { loadOpenRequests } from "@/lib/cached-api";
import { defaultQuantity, isFeeLine } from "@/lib/fee-lines";
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
  // The tax fields are folded away; the Purchaser opens them, or they open when the scan was unsure of one.
  // null = decided by the scan (opens for a new vendor or an unsure reading); true/false = the person's own choice.
  const [taxOpen, setTaxOpen] = useState<boolean | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  // Materials from the Site Managers' requests, for naming line items.
  const [materials, setMaterials] = useState<RequestedMaterial[]>([]);
  const [pickingItemId, setPickingItemId] = useState<string | null>(null);
  // What is left in the budgets of the requests this receipt can fill (centavos), for a split receipt.
  const [splitLeftCents, setSplitLeftCents] = useState<number | null>(null);
  // The requests this receipt is for, shown at the top of the review ("This receipt is for").
  const [forRequests, setForRequests] = useState<{ key: string; subject: string; project: string; left: number | null }[]>([]);

  // One receipt for one ticket: only that ticket's material. Split receipt:
  // every open request, since the receipt can fill any of them.
  const ticketId = draft.mode === "single" ? draft.ticket?.ticketId ?? null : null;
  useEffect(() => {
    let cancelled = false;
    loadOpenRequests()
      .then(({ data: requests }) => {
        if (cancelled) return;
        const mine = ticketId ? requests.filter((r) => r.ticketID === ticketId) : requests;
        // A split receipt can never cost more than every request it may fill has left (limited to the chosen project, if any).
        const scopeIds = draft.scope?.projectIds ?? [];
        const reachable = ticketId ? [] : requests.filter((r) => scopeIds.length === 0 || scopeIds.includes(r.projectID));
        const budgeted = reachable.filter((r) => r.remainingBudget != null);
        setForRequests((ticketId ? mine : reachable).map((r) => ({ key: r.ticketID, subject: r.subject, project: r.projectName, left: r.remainingBudget })));
        setSplitLeftCents(budgeted.length > 0 ? budgeted.reduce((sum, r) => sum + Math.round(Number(r.remainingBudget) * 100), 0) : null);
        setMaterials(
          mine.map((r) => ({
            key: r.ticketID,
            name: r.materialType,
            detail: t("rv.material_detail", { project: r.projectName, qty: r.remainingQuantity, subject: r.subject }),
            bomItemID: r.bomItemID ?? null,
            projectName: r.projectName,
            vendorName: r.vendorName,
            subject: r.subject,
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
        ? result.lineItems.map((li) => withUnitPrice({ id: makeId(), name: li.description ?? "", quantity: defaultQuantity(li.description, li.quantity), price: li.amount != null ? groupAmountText(String(li.amount)) : "", unitPrice: li.unitPrice != null ? groupAmountText(String(li.unitPrice)) : "", ocr: lineItemsOcr, scanned: draft.resubmit ? undefined : li.description || undefined }))
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
  // The strict budget (every role): the receipt can be under what is left, never over.
  // A split receipt is capped by the combined budget left on the requests it can fill; the exact split is checked on the next screen.
  const remainingCents = draft.resubmit
    ? null
    : !isSplit
      ? (draft.ticket?.remaining != null ? toCents(draft.ticket.remaining) : null)
      : splitLeftCents;
  const overCents = remainingCents !== null && totalCents !== null && totalCents > remainingCents ? totalCents - remainingCents : 0;
  const dateProblem = receiptDateProblem(receiptDate, t);
  const vendorMissing = vendorName.trim().length === 0;
  const canContinue = allLinesValid && totalsMatch && !dateProblem && !vendorMissing && overCents === 0;
  // Everything still blocking Continue. Always listed above the button, next to the
  // "Required" tags on the fields themselves.
  const blockedReasons = [
    vendorMissing && t("rv.err_vendor"),
    dateProblem,
    namedItems.length === 0 && t("rv.err_add_item"),
    namedItems.length > 0 && !allLinesValid && t("rv.err_lines"),
    totalCents === null && t("rv.err_total"),
    allLinesValid && totalCents !== null && !totalsMatch && t("rv.err_match"),
    overCents > 0 && t("bd.over_inline", { over: formatPesoCents(overCents) }),
  ];
  const bir = birStatusPreview({ tin, birPermitNumber, birNumber });
  const taxFlagged = isLowConfidence("tin") || isLowConfidence("birPermitNumber") || isLowConfidence("birNumber");
  const taxFilled = !!(tin.trim() || birPermitNumber.trim() || birNumber.trim());
  // A vendor that is not on the vendor list has no verified tax identity, so its tax details
  // open straight away for the person to double-check. They can still fold them away.
  const newVendor = !result.vendorMasterMatch;
  const showTax = taxOpen ?? (taxFlagged || newVendor);
  // Any edit counts as the user checking that row, so its OCR flag goes.
  function updateItem(id: string, patch: Partial<LineItem>) { setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch, ocr: undefined } : it))); }
  /** Synchronize a line's numeric fields and clear its OCR warning after an edit. */
  function editItem(id: string, field: "quantity" | "price" | "unitPrice", value: string) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...editLine(it, field, value), ocr: undefined } : it)));
  }
  function removeItem(id: string) { setItems((prev) => prev.filter((it) => it.id !== id)); }
  function addItem() { setItems((prev) => [...prev, { id: makeId(), name: "", quantity: "", price: "" }]); }

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
      // No adjusting it away: the amounts have to be corrected until the lines add up to the total.
      if (totalCents === null) return Alert.alert(t("rv.totals_mismatch"), t("rv.totals_body"));
      return Alert.alert(
        t("rv.totals_mismatch"),
        t(linesCents > totalCents ? "rv.totals_gap_over" : "rv.totals_gap_short", { gap: formatPesoCents(Math.abs(linesCents - totalCents)) })
      );
    }
    if (overCents > 0 && remainingCents !== null && totalCents !== null) {
      return Alert.alert(t("bd.over_title"), t("bd.over_body", { amount: formatPesoCents(totalCents), remaining: formatPesoCents(remainingCents) }));
    }
    const clean = (text: string) => Number(text.replace(/,/g, "").trim());
    setOcrResult({
      ...result!, vendorName: vendorName.trim(), tin, birPermitNumber, birNumber, amount: clean(amount), receiptDate: receiptDate.trim(),
      lineItems: namedItems.map((it) => ({ description: it.name.trim(), amount: clean(it.price), quantity: clean(it.quantity), unitPrice: unitPriceForPayload(it), bomItemID: it.bomItemID ?? null, matchedTicketID: it.matchedTicketID ?? null })),
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
      <FlowHeader title={t("mx.review_receipt")} caption={t("mx.step_n", { current: 2, total: 3 })} step={{ current: 2, total: 3 }} />
      <KeyboardAvoider style={styles.flex}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {draft.resubmit && (
            <View style={styles.rejectBox}>
              <Text style={styles.rejectTitle}>{t("rv.rejected_title")}</Text>
              <Text style={styles.rejectReason}>{draft.resubmit.reason ? `"${draft.resubmit.reason}"` : t("rv.no_reason")}</Text>
              <Text style={styles.rejectHint}>{t("rv.fix_hint")}</Text>
            </View>
          )}

          {(file || forRequests.length > 0 || remainingCents !== null) && (
            <View style={styles.summary}>
              <View style={styles.summaryTop}>
                {file && (
                  <Pressable
                    onPress={openReceiptFile}
                    style={({ pressed }) => pressed && styles.pressed}
                    accessibilityRole="button"
                    accessibilityLabel={file.type === "image" ? t("rv.file_aria_image") : t("rv.file_aria_pdf")}
                  >
                    {file.type === "image" ? (
                      <Image source={{ uri: file.uri }} style={styles.thumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.thumb, styles.thumbPdf]}><IconSymbol name="doc.fill" size={26} color={COLORS.errorText} /></View>
                    )}
                  </Pressable>
                )}
                <View style={styles.flex}>
                  {forRequests.length > 0 ? (
                    <>
                      <Text style={styles.summaryLabel}>{t("rv.for_title")}</Text>
                      <Text style={styles.summaryTitle} numberOfLines={2}>{forRequests.slice(0, 2).map((r) => r.subject).join(", ")}</Text>
                      <Text style={styles.summaryMeta} numberOfLines={1}>
                        {forRequests[0].project}{forRequests.length > 2 ? ` · ${t("rv.for_more", { count: forRequests.length - 2 })}` : ""}
                      </Text>
                    </>
                  ) : file ? (
                    <>
                      <Text style={styles.summaryTitle}>{t("rv.receipt_file")}</Text>
                      <Text style={styles.summaryMeta} numberOfLines={1}>{file.name}{file.type === "pdf" && file.size ? ` · ${file.size}` : ""}</Text>
                    </>
                  ) : null}
                  {file ? <Text style={styles.summaryHint}>{t("rv.tap_open")}</Text> : null}
                </View>
              </View>
              {remainingCents !== null ? (
                <View style={[styles.summaryBudget, overCents > 0 && styles.summaryBudgetOver]}>
                  <Text style={[styles.summaryBudgetLeft, overCents > 0 && styles.budgetTextOver]}>{t("bd.left", { remaining: formatPesoCents(remainingCents) })}</Text>
                  <Text style={[styles.summaryBudgetHint, overCents > 0 && styles.budgetTextOver]} numberOfLines={2}>
                    {overCents > 0 ? t("bd.over_inline", { over: formatPesoCents(overCents) }) : t("bd.under_inline")}
                  </Text>
                </View>
              ) : null}
            </View>
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
          ) : null}

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

          <Section title={t("rv.section_receipt")}>
            <Field label={t("dashboard.vendor")} value={vendorName} onChangeText={edit("vendorName", setVendorName)} check={isLowConfidence("vendorName")} error={vendorMissing ? REQUIRED : null} />
            <View style={styles.pair}>
              <Field style={styles.half} label={t("rv.total_php")} value={amount} onChangeText={(v) => edit("amount", setAmount)(groupAmountLive(v))} onBlur={() => setAmount(groupAmountText)} keyboardType="decimal-pad" check={ocrCheck("amount") !== null} error={totalCents === null ? REQUIRED : null} />
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
              const needName = namedItems.length === 0 && index === 0;
              return (
                <View key={item.id} style={[styles.lineBlock, index > 0 && styles.lineBlockDivider]}>
                  <View style={styles.lineNameRow}>
                    <TextInput style={[styles.input, styles.flex, needName && styles.inputRequired]} placeholder={t("rv.item_name_ph")} placeholderTextColor={COLORS.muted} value={item.name} onChangeText={(v) => updateItem(item.id, { name: v, bomItemID: null, matchedTicketID: null })} accessibilityLabel={t("submit.item_n", { n: index + 1 })} />
                    <Pressable onPress={() => removeItem(item.id)} hitSlop={6} style={styles.removeButton} accessibilityRole="button" accessibilityLabel={t("submit.remove_item_n", { n: index + 1 })}>
                      <Text style={styles.removeX}>×</Text>
                    </Pressable>
                  </View>
                  {(needName || item.ocr) && (
                    <View style={styles.tagRow}>
                      {needName && <Text style={styles.requiredTag}>{t("mx.required_tag")}</Text>}
                      {item.ocr && <Text style={styles.checkTag}>{t("rv.check_tag")}</Text>}
                    </View>
                  )}
                  {item.scanned && simpleText(item.scanned) !== simpleText(item.name) && (
                    <Text style={styles.scannedNote}>
                      {t("rv.receipt_says", { scanned: item.scanned })}
                    </Text>
                  )}
                  {item.matchedTicketID ? (
                    <View style={styles.matchedChip}>
                      <Text style={styles.matchedChipText} numberOfLines={2}>
                        {t("rv.matched_chip", {
                          request: materials.find((m) => m.key === item.matchedTicketID)?.name ?? item.name,
                          project: materials.find((m) => m.key === item.matchedTicketID)?.projectName ?? "",
                        })}
                      </Text>
                      <Pressable onPress={() => updateItem(item.id, { matchedTicketID: null })} hitSlop={8} accessibilityRole="button">
                        <Text style={styles.matchedChipRemove}>{t("rv.remove_match")}</Text>
                      </Pressable>
                    </View>
                  ) : materials.length > 0 ? (
                    <Pressable onPress={() => setPickingItemId(item.id)} style={({ pressed }) => [styles.matchLink, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={t("rv.pick_aria", { n: index + 1 })}>
                      <Text style={styles.matchLinkText}>{t("rv.match_material")}</Text>
                      <IconSymbol name="chevron.right" size={16} color={COLORS.primary} />
                    </Pressable>
                  ) : null}
                  <View style={styles.itemRow}>
                    <View style={styles.itemQty}>
                      <Text style={styles.miniLabel}>{t("split.col_qty")}{qtyBad ? <Text style={styles.requiredTag}> {t("mx.required_tag")}</Text> : null}</Text>
                      <TextInput style={[styles.input, qtyBad && styles.inputError]} placeholder="0" placeholderTextColor={COLORS.muted} value={item.quantity} keyboardType="decimal-pad" onChangeText={(v) => editItem(item.id, "quantity", v)} />
                    </View>
                    <View style={styles.itemAmount}>
                      <Text style={styles.miniLabel}>{t("submit.unit_price")}</Text>
                      <TextInput style={styles.input} placeholder={t("submit.calculated")} placeholderTextColor={COLORS.muted} value={item.unitPrice ?? ""} keyboardType="decimal-pad" onChangeText={(v) => editItem(item.id, "unitPrice", groupAmountLive(v))} onBlur={() => updateItem(item.id, { unitPrice: groupAmountText(item.unitPrice ?? "") })} />
                    </View>
                    <View style={styles.itemAmount}>
                      <Text style={styles.miniLabel}>{t("rv.line_amount")}{amountBad ? <Text style={styles.requiredTag}> {t("mx.required_tag")}</Text> : null}</Text>
                      <TextInput style={[styles.input, amountBad && styles.inputError]} placeholder="0.00" placeholderTextColor={COLORS.muted} value={item.price} keyboardType="decimal-pad" onChangeText={(v) => editItem(item.id, "price", groupAmountLive(v))} onBlur={() => updateItem(item.id, { price: groupAmountText(item.price) })} />
                    </View>
                  </View>
                </View>
              );
            })}
          </Section>

          <View style={styles.section}>
            <Pressable onPress={() => setTaxOpen(!showTax)} style={styles.taxHeader} accessibilityRole="button" accessibilityState={{ expanded: showTax }}>
              <View style={styles.flex}>
                <Text style={styles.sectionTitle}>
                  {t("submit.tax_details")}{" "}
                  {newVendor
                    ? <Text style={styles.taxCheck}>{t("rv.new_vendor_tag")}</Text>
                    : <Text style={styles.taxOptional}>({t("submit.optional")})</Text>}
                </Text>
                {taxFilled ? <Text style={styles.taxFilled}>{t("submit.tax_filled")}</Text> : null}
              </View>
              <IconSymbol name={showTax ? "chevron.down" : "chevron.right"} size={22} color={COLORS.muted} />
            </Pressable>
            {showTax && (
              <View style={styles.taxFields}>
              {newVendor && (
                <View style={styles.newVendorBox} accessibilityRole="alert">
                  <IconSymbol name="info.circle.fill" size={20} color={COLORS.amberText} />
                  <Text style={styles.newVendorText}>
                    <Text style={styles.newVendorTitle}>{t("rv.new_vendor_title")} </Text>
                    {t("rv.new_vendor_body", { vendor: vendorName.trim() || t("dashboard.vendor") })}
                  </Text>
                </View>
              )}
              <View style={styles.pair}>
                <Field style={styles.half} label="TIN" value={tin} onChangeText={edit("tin", setTin)} keyboardType="numbers-and-punctuation" check={isLowConfidence("tin")} fromVendorList={autoFilled.includes("tin")} />
                <Field style={styles.half} label={t("rv.bir_permit")} value={birPermitNumber} onChangeText={edit("birPermitNumber", setBirPermitNumber)} autoCapitalize="characters" check={isLowConfidence("birPermitNumber")} fromVendorList={autoFilled.includes("birPermitNumber")} />
              </View>
              <Field label="OR / SI number" value={birNumber} onChangeText={edit("birNumber", setBirNumber)} autoCapitalize="characters" check={isLowConfidence("birNumber")} />
              </View>
            )}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.totalsRow}>
            {totalsMatch && <IconSymbol name="checkmark.circle.fill" size={16} color={COLORS.success} />}
            <Text style={[styles.totalsLine, { color: totalsMatch ? COLORS.success : RED }]}>
              {t("rv.lines_of", { lines: formatPesoCents(linesCents), total: totalCents === null ? "—" : formatPesoCents(totalCents) })}
            </Text>
          </View>
          <BlockedReasons title={t("gap.title")} reasons={blockedReasons} />
          <Pressable style={[styles.submitButton, !canContinue && styles.submitButtonDisabled]} onPress={handleContinue} accessibilityRole="button" accessibilityState={{ disabled: !canContinue }}>
            <Text style={styles.submitButtonText}>{t("rv.continue")}</Text>
          </Pressable>
        </View>
      </KeyboardAvoider>

      <RequestedMaterialPicker
        visible={pickingItemId !== null}
        materials={materials}
        lineText={(() => { const it = items.find((i) => i.id === pickingItemId); return it ? it.scanned || it.name : ""; })()}
        onClose={() => setPickingItemId(null)}
        onSelect={(m) => {
          const it = items.find((i) => i.id === pickingItemId);
          if (it) {
            // A fee line (delivery, VAT) keeps its own name: it is matched to the request, not renamed to a material.
            const fee = isFeeLine(it.scanned || it.name) || toHundredths(it.quantity) === 0;
            updateItem(it.id, fee ? { matchedTicketID: m.key } : { name: m.name, bomItemID: m.bomItemID ?? null, matchedTicketID: m.key });
          }
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
  summary: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 12, marginBottom: 12, gap: 10 },
  summaryTop: { flexDirection: "row", gap: 12, alignItems: "center" },
  summaryLabel: { fontSize: 12, fontFamily: FONT.semibold, color: COLORS.muted },
  summaryTitle: { fontSize: 16, fontFamily: FONT.extrabold, color: COLORS.heading, marginTop: 1 },
  summaryMeta: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 1 },
  summaryHint: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.primary, marginTop: 6 },
  summaryBudget: { backgroundColor: COLORS.successBg, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, gap: 1 },
  summaryBudgetOver: { backgroundColor: COLORS.errorFill },
  summaryBudgetLeft: { fontSize: 14, fontFamily: FONT.bold, color: COLORS.success },
  summaryBudgetHint: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.success },
  lineBlock: { gap: 8, paddingVertical: 4 },
  lineBlockDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border, paddingTop: 14, marginTop: 6 },
  lineNameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  tagRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  matchLink: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 36, alignSelf: "flex-start" },
  matchLinkText: { fontSize: 14, fontFamily: FONT.semibold, color: COLORS.primary },
  removeX: { fontSize: 24, lineHeight: 26, fontFamily: FONT.regular, color: COLORS.muted },
  thumbRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 10, marginBottom: 10 },
  thumb: { width: 64, height: 84, borderRadius: 10, backgroundColor: COLORS.bg },
  thumbPdf: { alignItems: "center", justifyContent: "center" },
  thumbTitle: { fontSize: 14, fontFamily: FONT.extrabold, color: COLORS.heading },
  thumbName: { fontSize: 12, fontFamily: FONT.medium, color: COLORS.heading, marginTop: 1 },
  thumbHint: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 2 },
  banner: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: COLORS.amberBannerFill, borderWidth: 1, borderColor: COLORS.amberBorder, borderRadius: 14, padding: 12, marginBottom: 10 },
  bannerTitle: { fontSize: 14, fontFamily: FONT.extrabold, color: COLORS.amberBannerText },
  bannerText: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.amberBannerText, lineHeight: 18, marginTop: 2 },
  pair: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
  checkTag: { fontSize: 12, fontFamily: FONT.bold, color: COLORS.amberText, backgroundColor: COLORS.amberBannerFill, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8, overflow: "hidden" },
  requiredTag: { fontSize: 12, fontFamily: FONT.bold, color: COLORS.errorText },
  inputRequired: { backgroundColor: COLORS.errorFill, borderWidth: 1.5 },
  addButton: { minHeight: 44, justifyContent: "center", paddingLeft: 8 },
  removeButton: { minHeight: 44, minWidth: 40, alignItems: "center", justifyContent: "center" },
  totalsRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 8 },
  birBadge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, marginBottom: 10 },
  birFormal: { backgroundColor: COLORS.successBg },
  birInformal: { backgroundColor: AMBER_BG },
  birText: { fontSize: 12, fontFamily: FONT.bold },
  birNote: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, marginTop: -4, marginBottom: 10 },
  warnBox: { backgroundColor: AMBER_BG, borderRadius: 12, padding: 12, marginBottom: 10, gap: 4 },
  warnTitle: { fontSize: 13, fontFamily: FONT.extrabold, color: AMBER },
  warnLine: { fontSize: 12, fontFamily: FONT.regular, color: AMBER },
  taxHeader: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48 },
  taxOptional: { fontFamily: FONT.regular, color: COLORS.muted, fontSize: 13 },
  taxCheck: { fontFamily: FONT.bold, color: COLORS.amberText, fontSize: 13 },
  newVendorBox: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.amberBorder, backgroundColor: COLORS.amberFill },
  newVendorText: { flex: 1, fontSize: 13, fontFamily: FONT.regular, color: COLORS.amberText, lineHeight: 19 },
  newVendorTitle: { fontFamily: FONT.bold },
  taxFilled: { fontSize: 12, fontFamily: FONT.semibold, color: COLORS.success, marginTop: 2 },
  taxFields: { gap: 10, marginTop: 8 },
  section: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 14, marginBottom: 12 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontFamily: FONT.extrabold, color: COLORS.heading },
  field: { marginBottom: 12 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  fieldLabel: { fontSize: 12, fontFamily: FONT.semibold, color: COLORS.muted },
  vendorBadge: { fontSize: 12, fontFamily: FONT.bold, color: COLORS.success, backgroundColor: COLORS.successBg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  input: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 12, paddingHorizontal: 12, minHeight: 44, paddingVertical: 10, fontSize: 15, fontFamily: FONT.regular, color: COLORS.heading },
  dateInput: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dateText: { fontSize: 15, fontFamily: FONT.regular, color: COLORS.heading },
  inputLow: { borderColor: COLORS.amberBorder, backgroundColor: COLORS.amberFill },
  inputError: { borderColor: RED },
  lowHint: { fontSize: 12, fontFamily: FONT.regular, color: AMBER, marginTop: 4 },
  errorHint: { fontSize: 12, fontFamily: FONT.regular, color: RED, marginTop: 4 },
  addLink: { fontSize: 13, fontFamily: FONT.bold, color: COLORS.success },
  hint: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, marginBottom: 8 },
  forBox: { backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, padding: 12, gap: 4 },
  forTitle: { fontSize: 12, fontFamily: FONT.bold, color: COLORS.muted },
  forRow: { fontSize: 13, fontFamily: FONT.semibold, color: COLORS.heading },
  forMore: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted },
  budgetBox: { backgroundColor: COLORS.successBg, borderRadius: 12, padding: 12, gap: 2 },
  budgetBoxOver: { backgroundColor: COLORS.errorFill },
  budgetLeft: { fontSize: 14, fontFamily: FONT.bold, color: COLORS.success },
  budgetHint: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.success },
  budgetTextOver: { color: COLORS.errorText },
  matchedChip: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, backgroundColor: COLORS.successBg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  matchedChipText: { flex: 1, fontSize: 12, fontFamily: FONT.semibold, color: COLORS.success },
  matchedChipRemove: { fontSize: 12, fontFamily: FONT.bold, color: COLORS.muted, textDecorationLine: "underline" },
  pickButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 12, paddingHorizontal: 12, backgroundColor: COLORS.card },
  pickButtonText: { fontSize: 14, fontFamily: FONT.medium, color: COLORS.muted },
  scannedNote: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted },
  itemLabelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  itemCardOcr: { borderColor: COLORS.amberBorder, backgroundColor: COLORS.amberFill },
  ocrBadge: { fontSize: 11, fontFamily: FONT.bold, color: AMBER, backgroundColor: AMBER_BG, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8, overflow: "hidden" },
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
  miniLabel: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, marginBottom: 4 },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.bg },
  totalsLine: { fontSize: 13, fontFamily: FONT.bold, textAlign: "center" },
  pressed: { opacity: 0.85 },
  zoomBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center", padding: 12 },
  zoomImage: { width: "100%", height: "88%" },
  zoomHint: { color: "rgba(255,255,255,0.8)", fontSize: 13, fontFamily: FONT.regular, marginTop: 10 },
  submitButton: { minHeight: 48, backgroundColor: COLORS.primary, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: "#FFF", fontFamily: FONT.bold, fontSize: 16 },
});
