import React, { useEffect, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
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

import { FlowHeader } from "@/components/flow-header";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useExpenseDraft } from "@/lib/expense-draft-context";
import type { LineItem } from "@/lib/expense-types";
import { COLORS } from "@/constants/expense-flow-colors";
import { formatPesoCents, toCents, toHundredths } from "@/lib/money";
import { birStatusPreview, receiptDateProblem } from "@/lib/receipt-checks";

const RED = "#C1121F";
const AMBER = "#B45309";
const AMBER_BG = "#FEF3C7";
const PERMIT_TYPES = ["Permit", "PTU", "ATP"] as const;

// Our field name -> the key the parser uses in `confidence`.
const CONFIDENCE_KEY: Record<string, string> = {
  vendorName: "vendorName", tin: "tin", birPermitNumber: "birPermitNumber",
  birNumber: "orSiNumber", amount: "amount", receiptDate: "date",
};
const FIELD_LABEL: Record<string, string> = { tin: "TIN", birPermitType: "BIR authority type", birPermitNumber: "BIR permit" };

function makeId() { return Math.random().toString(36).slice(2, 10); }

export default function ReviewScreen() {
  const { draft, setOcrResult } = useExpenseDraft();
  const result = draft.ocrResult;

  const [vendorName, setVendorName] = useState("");
  const [tin, setTin] = useState("");
  const [birPermitType, setBirPermitType] = useState("");
  const [birPermitNumber, setBirPermitNumber] = useState("");
  const [birNumber, setBirNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [receiptDate, setReceiptDate] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  // Fields the user has edited: their low-confidence warning is dropped.
  const [edited, setEdited] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!result) return;
    setVendorName(result.vendorName ?? "");
    setTin(result.tin ?? "");
    setBirPermitType(result.birPermitType ?? "");
    setBirPermitNumber(result.birPermitNumber ?? "");
    setBirNumber(result.birNumber ?? "");
    setAmount(result.amount != null ? String(result.amount) : "");
    setReceiptDate(result.receiptDate ?? "");
    setItems(
      result.lineItems?.length
        ? result.lineItems.map((li) => ({ id: makeId(), name: li.description ?? "", quantity: li.quantity != null ? String(li.quantity) : "", price: li.amount != null ? String(li.amount) : "" }))
        : [{ id: makeId(), name: result.vendorName ?? "", quantity: "", price: result.amount != null ? String(result.amount) : "" }]
    );
    setEdited(new Set());
  }, [result]);

  if (!result) return <Redirect href="/" />;

  const isSplit = draft.mode === "split";
  const autoFilled = result.autoFilled ?? [];
  const conflicts = result.vendorConflicts ?? [];

  function edit(field: string, setter: (v: string) => void) {
    return (value: string) => {
      setter(value);
      setEdited((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
    };
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

  function updateItem(id: string, patch: Partial<LineItem>) { setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it))); }
  function removeItem(id: string) { setItems((prev) => prev.filter((it) => it.id !== id)); }
  function addItem() { setItems((prev) => [...prev, { id: makeId(), name: "", quantity: "", price: "" }]); }

  function handleContinue() {
    if (vendorMissing) return Alert.alert("Vendor required", "Enter the store or vendor name.");
    if (dateProblem) return Alert.alert("Check the date", dateProblem);
    if (namedItems.length === 0) return Alert.alert("Add at least one item", "Every expense needs at least one line item.");
    if (!allLinesValid) return Alert.alert("Check the line items", "Every line needs a quantity and an amount. Use 0 for delivery, VAT and fees.");
    if (!totalsMatch) return Alert.alert("Totals don't match", "The line items must add up to the receipt total.");
    const clean = (text: string) => Number(text.replace(/,/g, "").trim());
    setOcrResult({
      ...result!, vendorName: vendorName.trim(), tin, birPermitType, birPermitNumber, birNumber, amount: clean(amount), receiptDate: receiptDate.trim(),
      lineItems: namedItems.map((it) => ({ description: it.name.trim(), amount: clean(it.price), quantity: clean(it.quantity), unitPrice: null })),
    });
    router.push(isSplit ? "/expense/allocate" : "/expense/link");
  }

  const file = draft.file;

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlowHeader title="Review receipt" caption={isSplit ? "Split receipt · Step 2 of 3" : "Step 2 of 3"} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {file && (
            <View style={styles.thumbRow}>
              {file.type === "image" ? (
                <Image source={{ uri: file.uri }} style={styles.thumb} resizeMode="cover" />
              ) : (
                <View style={[styles.thumb, styles.thumbPdf]}><IconSymbol name="doc.fill" size={26} color={COLORS.muted} /></View>
              )}
              <View style={styles.flex}>
                <Text style={styles.thumbName} numberOfLines={1}>{file.name}</Text>
                <Text style={styles.thumbHint}>Compare each value with the paper receipt.</Text>
              </View>
            </View>
          )}

          <View style={[styles.birBadge, bir.formal ? styles.birFormal : styles.birInformal]}>
            <IconSymbol name={bir.formal ? "checkmark.seal.fill" : "exclamationmark.triangle.fill"} size={16} color={bir.formal ? COLORS.success : AMBER} />
            <Text style={[styles.birText, { color: bir.formal ? COLORS.success : AMBER }]}>
              {bir.formal ? "Formal · tax-deductible" : `Informal · missing ${bir.missing.join(", ")}`}
            </Text>
          </View>

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
            <View style={styles.field}>
              <View style={styles.labelRow}>
                <Text style={styles.fieldLabel}>BIR authority type</Text>
                {autoFilled.includes("birPermitType") && <VendorListBadge />}
              </View>
              <View style={styles.chipRow}>
                {PERMIT_TYPES.map((type) => {
                  const active = birPermitType.toUpperCase() === type.toUpperCase();
                  return (
                    <Pressable key={type} onPress={() => setBirPermitType(active ? "" : type)} style={[styles.chip, active && styles.chipActive]}>
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{type}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <Field label="BIR permit number" value={birPermitNumber} onChangeText={edit("birPermitNumber", setBirPermitNumber)} autoCapitalize="characters" lowConfidence={isLowConfidence("birPermitNumber")} fromVendorList={autoFilled.includes("birPermitNumber")} />
            <Field label="OR / SI number" value={birNumber} onChangeText={edit("birNumber", setBirNumber)} autoCapitalize="characters" lowConfidence={isLowConfidence("birNumber")} />
          </Section>

          <Section title="Amount & date">
            <Field label="Receipt total (₱)" value={amount} onChangeText={edit("amount", setAmount)} keyboardType="decimal-pad" lowConfidence={isLowConfidence("amount")} error={totalCents === null ? "Enter the total, e.g. 1250.00" : null} />
            <Field label="Receipt date" value={receiptDate} onChangeText={edit("receiptDate", setReceiptDate)} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" lowConfidence={isLowConfidence("receiptDate")} error={dateProblem} />
          </Section>

          <Section
            title={`Line items (${items.length})`}
            action={<Pressable onPress={addItem} hitSlop={8}><Text style={styles.addLink}>+ Add item</Text></Pressable>}
          >
            <Text style={styles.hint}>Qty is required. Use 0 for delivery, VAT and fees.</Text>
            {items.map((item, index) => {
              const named = item.name.trim().length > 0;
              const qtyBad = named && toHundredths(item.quantity) === null;
              const amountBad = named && toCents(item.price) === null;
              return (
                <View key={item.id} style={styles.itemCard}>
                  <View style={styles.itemTop}>
                    <Text style={styles.itemIndex}>Item {index + 1}</Text>
                    <Pressable onPress={() => removeItem(item.id)} hitSlop={8} accessibilityLabel={`Remove item ${index + 1}`}>
                      <Text style={styles.removeText}>Remove</Text>
                    </Pressable>
                  </View>
                  <TextInput style={styles.input} placeholder="Item name" placeholderTextColor={COLORS.muted} value={item.name} onChangeText={(v) => updateItem(item.id, { name: v })} />
                  <View style={styles.itemRow}>
                    <View style={styles.itemQty}>
                      <Text style={styles.miniLabel}>Qty</Text>
                      <TextInput style={[styles.input, qtyBad && styles.inputError]} placeholder="0" placeholderTextColor={COLORS.muted} value={item.quantity} keyboardType="decimal-pad" onChangeText={(v) => updateItem(item.id, { quantity: v })} />
                    </View>
                    <View style={styles.itemAmount}>
                      <Text style={styles.miniLabel}>Line amount (₱)</Text>
                      <TextInput style={[styles.input, amountBad && styles.inputError]} placeholder="0.00" placeholderTextColor={COLORS.muted} value={item.price} keyboardType="decimal-pad" onChangeText={(v) => updateItem(item.id, { price: v })} />
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
          <Pressable style={[styles.submitButton, !canContinue && styles.submitButtonDisabled]} onPress={handleContinue} accessibilityRole="button" accessibilityState={{ disabled: !canContinue }}>
            <Text style={styles.submitButtonText}>Looks correct — Continue</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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
  keyboardType?: "default" | "decimal-pad" | "numeric" | "numbers-and-punctuation";
  autoCapitalize?: "none" | "characters" | "words" | "sentences";
  placeholder?: string;
  lowConfidence?: boolean;
  fromVendorList?: boolean;
  error?: string | null;
};

function Field({ label, value, onChangeText, keyboardType, autoCapitalize, placeholder, lowConfidence, fromVendorList, error }: FieldProps) {
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
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        placeholder={placeholder ?? "—"}
        placeholderTextColor={COLORS.muted}
      />
      {error ? (
        <Text style={styles.errorHint}>{error}</Text>
      ) : lowConfidence ? (
        <Text style={styles.lowHint}>Low OCR confidence — check this against the receipt.</Text>
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
  inputLow: { borderColor: AMBER, backgroundColor: "#FFFBEB" },
  inputError: { borderColor: RED },
  lowHint: { fontSize: 11, color: AMBER, marginTop: 4 },
  errorHint: { fontSize: 11, color: RED, marginTop: 4 },
  chipRow: { flexDirection: "row", gap: 8 },
  chip: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: COLORS.card },
  chipActive: { borderColor: COLORS.primary, backgroundColor: "#FDECE1" },
  chipText: { fontSize: 13, fontWeight: "600", color: COLORS.heading },
  chipTextActive: { color: COLORS.primary },
  addLink: { fontSize: 13, fontWeight: "700", color: COLORS.success },
  hint: { fontSize: 11, color: COLORS.muted, marginBottom: 8 },
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
  submitButton: { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: "#FFF", fontWeight: "700", fontSize: 16 },
});
