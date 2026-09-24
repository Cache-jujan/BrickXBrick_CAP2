import React, { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router} from "expo-router";

import { useExpenseDraft } from "@/lib/expense-draft-context";
import type { LineItem } from "@/lib/expense-types";
import { COLORS } from "@/constants/expense-flow-colors";

function makeId() { return Math.random().toString(36).slice(2, 10); }

export default function ReviewScreen() {
  const { draft, setOcrResult } = useExpenseDraft();
  const result = draft.ocrResult;

  const [vendorName, setVendorName] = useState("");
  const [tin, setTin] = useState("");
  const [birNumber, setBirNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [receiptDate, setReceiptDate] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);

  useEffect(() => {
    if (!result) return;
    setVendorName(result.vendorName ?? "");
    setTin(result.tin ?? "");
    setBirNumber(result.birNumber ?? "");
    setAmount(result.amount != null ? String(result.amount) : "");
    setReceiptDate(result.receiptDate ?? "");
    setItems(
      result.lineItems?.length
        ? result.lineItems.map((li) => ({ id: makeId(), name: li.description ?? "", quantity: li.quantity != null ? String(li.quantity) : "1", price: li.amount != null ? String(li.amount) : "" }))
        : [{ id: makeId(), name: result.vendorName ?? "", quantity: "1", price: result.amount != null ? String(result.amount) : "" }]
    );
  }, [result]);

  if (!result) return <Redirect href="/" />;

  function updateItem(id: string, patch: Partial<LineItem>) { setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it))); }
  function removeItem(id: string) { setItems((prev) => prev.filter((it) => it.id !== id)); }
  function addItem() { setItems((prev) => [...prev, { id: makeId(), name: "", quantity: "1", price: "" }]); }

  function handleContinue() {
    if (items.every((it) => !it.name.trim())) return Alert.alert("Add at least one item", "Every expense needs at least one line item.");
    setOcrResult({
      ...result, vendorName, tin, birNumber, amount: amount ? Number(amount) : null, receiptDate,
      lineItems: items.filter((it) => it.name.trim().length > 0).map((it) => ({ description: it.name.trim(), amount: Number(it.price) || 0, quantity: it.quantity ? Number(it.quantity) : 1, unitPrice: null })),
    });
    router.push("/expense/link");
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.subtitle}>Verify extracted receipt data</Text>
        <Text style={styles.title}>Review & Edit Receipt</Text>
        <ScrollView style={{ flex: 1 }}>
          <Field label="Vendor" value={vendorName} onChangeText={setVendorName} />
          <Field label="TIN" value={tin} onChangeText={setTin} />
          <Field label="OR/SI #" value={birNumber} onChangeText={setBirNumber} />
          <Field label="Total Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Field label="Date" value={receiptDate} onChangeText={setReceiptDate} />
          <View style={styles.itemsHeader}>
            <Text style={styles.itemsTitle}>Line Items ({items.length})</Text>
            <TouchableOpacity onPress={addItem}><Text style={styles.addLink}>+ Add item</Text></TouchableOpacity>
          </View>
          {items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <TextInput style={[styles.itemInput, { flex: 3 }]} placeholder="Item name" value={item.name} onChangeText={(v) => updateItem(item.id, { name: v })} />
              <TextInput style={[styles.itemInput, { flex: 1, textAlign: "center" }]} placeholder="Qty" value={item.quantity} keyboardType="numeric" onChangeText={(v) => updateItem(item.id, { quantity: v })} />
              <TextInput style={[styles.itemInput, { flex: 1.4 }]} placeholder="₱0.00" value={item.price} keyboardType="decimal-pad" onChangeText={(v) => updateItem(item.id, { price: v })} />
              <TouchableOpacity onPress={() => removeItem(item.id)} style={styles.removeBtn}><Text style={{ color: "#C1121F", fontWeight: "700" }}>✕</Text></TouchableOpacity>
            </View>
          ))}
        </ScrollView>
        <TouchableOpacity style={styles.submitButton} onPress={handleContinue}><Text style={styles.submitButtonText}>Looks Correct — Continue</Text></TouchableOpacity>
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
  removeBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#F6E3E3" },
  submitButton: { marginTop: 12, backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  submitButtonText: { color: "#FFF", fontWeight: "700", fontSize: 15 },
});