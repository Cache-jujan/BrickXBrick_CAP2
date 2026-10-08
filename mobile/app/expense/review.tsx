import React, { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router} from "expo-router";

import { useExpenseDraft } from "@/lib/expense-draft-context";
import type { LineItem } from "@/lib/expense-types";
import { COLORS } from "@/constants/expense-flow-colors";
import { formatPesoCents, toCents, toHundredths } from "@/lib/money";

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
  }, [result]);

  if (!result) return <Redirect href="/" />;

  const isSplit = draft.mode === "split";

  // Every named line needs a quantity (0 for delivery, VAT, fees) and an amount.
  // A missing quantity used to default to 1, which made Layer 3 flag fee lines.
  const namedItems = items.filter((it) => it.name.trim().length > 0);
  const isLineValid = (it: LineItem) => toHundredths(it.quantity) !== null && toCents(it.price) !== null;
  const allLinesValid = namedItems.length > 0 && namedItems.every(isLineValid);
  const totalCents = toCents(amount);
  const linesCents = namedItems.reduce((sum, it) => sum + (toCents(it.price) ?? 0), 0);
  const totalsMatch = totalCents !== null && linesCents === totalCents;
  const canContinue = allLinesValid && totalsMatch;

  function updateItem(id: string, patch: Partial<LineItem>) { setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it))); }
  function removeItem(id: string) { setItems((prev) => prev.filter((it) => it.id !== id)); }
  function addItem() { setItems((prev) => [...prev, { id: makeId(), name: "", quantity: "", price: "" }]); }

  function handleContinue() {
    if (namedItems.length === 0) return Alert.alert("Add at least one item", "Every expense needs at least one line item.");
    if (!allLinesValid) return Alert.alert("Check the line items", "Every line needs a quantity and an amount. Use 0 for delivery, VAT and fees.");
    if (!totalsMatch) return Alert.alert("Totals don't match", "The line items must add up to the receipt total.");
    const clean = (text: string) => Number(text.replace(/,/g, "").trim());
    setOcrResult({
      ...result, vendorName, tin, birPermitType, birPermitNumber, birNumber, amount: clean(amount), receiptDate,
      lineItems: namedItems.map((it) => ({ description: it.name.trim(), amount: clean(it.price), quantity: clean(it.quantity), unitPrice: null })),
    });
    router.push(isSplit ? "/expense/allocate" : "/expense/link");
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.subtitle}>{isSplit ? "Split receipt · Step 2 of 3" : "Verify extracted receipt data"}</Text>
        <Text style={styles.title}>Review & Edit Receipt</Text>
        <ScrollView style={{ flex: 1 }}>
          <Field label="Vendor" value={vendorName} onChangeText={setVendorName} />
          <Field label="TIN" value={tin} onChangeText={setTin} />
          <Field label="BIR authority type" value={birPermitType} onChangeText={setBirPermitType} />
          <Field label="BIR Permit Number" value={birPermitNumber} onChangeText={setBirPermitNumber} />
          <Field label="OR/SI #" value={birNumber} onChangeText={setBirNumber} />
          <Field label="Total Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Field label="Date" value={receiptDate} onChangeText={setReceiptDate} />
          <View style={styles.itemsHeader}>
            <Text style={styles.itemsTitle}>Line Items ({items.length})</Text>
            <TouchableOpacity onPress={addItem}><Text style={styles.addLink}>+ Add item</Text></TouchableOpacity>
          </View>
          <Text style={styles.hint}>Qty is required. Use 0 for delivery, VAT and fees.</Text>
          {items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <TextInput style={[styles.itemInput, { flex: 3 }]} placeholder="Item name" value={item.name} onChangeText={(v) => updateItem(item.id, { name: v })} />
              <TextInput style={[styles.itemInput, { flex: 1, textAlign: "center" }, !!item.name.trim() && toHundredths(item.quantity) === null && styles.itemInputError]} placeholder="Qty" value={item.quantity} keyboardType="numeric" onChangeText={(v) => updateItem(item.id, { quantity: v })} />
              <TextInput style={[styles.itemInput, { flex: 1.4 }, !!item.name.trim() && toCents(item.price) === null && styles.itemInputError]} placeholder="₱0.00" value={item.price} keyboardType="decimal-pad" onChangeText={(v) => updateItem(item.id, { price: v })} />
              <TouchableOpacity onPress={() => removeItem(item.id)} style={styles.removeBtn}><Text style={{ color: "#C1121F", fontWeight: "700" }}>✕</Text></TouchableOpacity>
            </View>
          ))}
        </ScrollView>
        <Text style={[styles.totalsLine, { color: totalsMatch ? COLORS.success : "#C1121F" }]}>
          Lines {formatPesoCents(linesCents)} of {totalCents === null ? "—" : formatPesoCents(totalCents)}
        </Text>
        <TouchableOpacity style={[styles.submitButton, !canContinue && styles.submitButtonDisabled]} onPress={handleContinue} disabled={!canContinue}>
          <Text style={styles.submitButtonText}>Looks Correct — Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function Field({ label, value, onChangeText, keyboardType }: { label: string; value: string; onChangeText: (v: string) => void; keyboardType?: "default" | "decimal-pad" | "numeric" }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.fieldInput} value={value} onChangeText={onChangeText} keyboardType={keyboardType} placeholder="—" />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1, padding: 20 },
  subtitle: { fontSize: 12, color: COLORS.muted },
  title: { fontSize: 20, fontWeight: "800", color: COLORS.heading, marginBottom: 14 },
  field: { marginBottom: 10 },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: COLORS.muted, marginBottom: 4 },
  fieldInput: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: COLORS.heading },
  itemsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10, marginBottom: 8 },
  itemsTitle: { fontSize: 14, fontWeight: "700", color: COLORS.heading },
  addLink: { fontSize: 13, fontWeight: "600", color: COLORS.success },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  itemInput: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: COLORS.heading },
  itemInputError: { borderColor: "#C1121F" },
  hint: { fontSize: 11, color: COLORS.muted, marginBottom: 8 },
  totalsLine: { marginTop: 10, fontSize: 13, fontWeight: "700", textAlign: "center" },
  submitButtonDisabled: { opacity: 0.5 },
  removeBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#F6E3E3" },
  submitButton: { marginTop: 12, backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  submitButtonText: { color: "#FFF", fontWeight: "700", fontSize: 15 },
});
