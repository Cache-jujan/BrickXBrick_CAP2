import React, { useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

// UI-local line item shape — this is what the editable rows in the modal
// use. It is NOT the same shape the backend speaks (see BackendLineItem
// below); the mapping between the two happens in the useEffect (in) and
// handleConfirm (out).
export type LineItem = {
  id: string;
  name: string;
  quantity: string;
  price: string;
};

// Shape of one entry in receiptFields.js's `lineItems` — what /receipts/scan
// returns and what POST /expenses expects back.
export type BackendLineItem = {
  description: string;
  amount: number;
  quantity: number | null;
  unitPrice: number | null;
};

// Matches receiptFields.js's toExpenseDraft() output field-for-field, so a
// confirmed OcrResult can be POSTed to /api/expenses with no further
// translation. `[key: string]: any` lets extra backend-only fields
// (receiptImageURL, birPermitNumber, quantity, confidence, ocrError,
// rawText, birValidationStatus, missingBirFields) pass through untouched —
// this modal doesn't display them, but index.tsx still carries them in
// ocrResult for later use.
export type OcrResult = {
  vendorName: string | null;
  tin: string | null;
  birNumber: string | null;
  amount: number | string | null;
  receiptDate: string | null;
  lineItems?: BackendLineItem[];
  [key: string]: any;
};

type Props = {
  visible: boolean;
  result: OcrResult | null;
  /** Once true, every field/item becomes permanently read-only. */
  locked: boolean;
  onConfirm: (final: OcrResult) => void;
  onClose: () => void;
};

const COLORS = {
  bg: "#F8F1E8",
  ink: "#1A1A1A",
  card: "#FFFFFF",
  border: "#EDE6D9",
  muted: "#8A8272",
  danger: "#C1121F",
  accent: "#2F6F4E",
};

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

export function OcrResultModal({ visible, result, locked, onConfirm, onClose }: Props) {
  const [vendorName, setVendorName] = useState("");
  const [tin, setTin] = useState("");
  const [birNumber, setBirNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [receiptDate, setReceiptDate] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);

  // Re-seed the editable copy whenever a fresh OCR result comes in.
  // We never mutate `result` directly — this local state is what the
  // user edits, and it's what gets handed back via onConfirm.
  useEffect(() => {
    if (!result) return;
    setVendorName(result.vendorName ?? "");
    setTin(result.tin ?? "");
    setBirNumber(result.birNumber ?? "");
    setAmount(result.amount != null ? String(result.amount) : "");
    setReceiptDate(result.receiptDate ?? "");
    setItems(
      result.lineItems?.length
        ? result.lineItems.map((li) => ({
            id: makeId(),
            name: li.description ?? "",
            quantity: li.quantity != null ? String(li.quantity) : "",
            price: li.amount != null ? String(li.amount) : "",
          }))
        : []
    );
  }, [result]);

  function updateItem(id: string, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  function addItem() {
    setItems((prev) => [...prev, { id: makeId(), name: "", quantity: "1", price: "" }]);
  }

  // This is a *warning*, not the lock itself — tapping "Confirm Details"
  // doesn't lock anything until the user explicitly agrees here. Once they
  // do, `locked` flips true upstream and every input in this sheet becomes
  // permanently read-only for this receipt.
  function handleConfirm() {
    Alert.alert(
      "Confirm receipt details?",
      "You can review and edit these fields as many times as you like right now, but once confirmed they lock and can't be changed again. Continue?",
      [
        { text: "Keep editing", style: "cancel" },
        {
          text: "Confirm",
          style: "destructive",
          onPress: () =>
            onConfirm({
              // Spread the original scan result FIRST so fields this modal
              // never displays — receiptImageURL, birPermitNumber, quantity,
              // confidence, etc. — survive into the confirmed object instead
              // of being dropped. The user-edited fields below then override
              // their stale counterparts from the original scan.
              ...(result ?? {}),
              vendorName,
              tin,
              birNumber,
              amount: amount ? Number(amount) : null,
              receiptDate,
              // Drop rows with no name typed — mirrors normalizeLineItems()
              // on the backend, which would reject them anyway.
              lineItems: items
                .filter((it) => it.name.trim().length > 0)
                .map((it) => ({
                  description: it.name.trim(),
                  amount: Number(it.price) || 0,
                  quantity: it.quantity ? Number(it.quantity) : null,
                  unitPrice: null,
                })),
            }),
        },
      ]
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <Text style={styles.title}>
            {locked ? "Confirmed Details" : "Verify Extracted Fields"}
          </Text>
          <Text style={styles.subtitle}>
            {locked
              ? "These details are locked in for this receipt."
              : "Fix anything OCR missed. You can edit or clear any field, and this can only be confirmed once."}
          </Text>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <Field
              label="Store"
              value={vendorName}
              onChangeText={setVendorName}
              onClear={() => setVendorName("")}
              editable={!locked}
            />
            <Field
              label="TIN"
              value={tin}
              onChangeText={setTin}
              onClear={() => setTin("")}
              editable={!locked}
            />
            <Field
              label="OR/SI #"
              value={birNumber}
              onChangeText={setBirNumber}
              onClear={() => setBirNumber("")}
              editable={!locked}
            />
            <Field
              label="Amount"
              value={amount}
              onChangeText={setAmount}
              onClear={() => setAmount("")}
              editable={!locked}
              keyboardType="decimal-pad"
            />
            <Field
              label="Date"
              value={receiptDate}
              onChangeText={setReceiptDate}
              onClear={() => setReceiptDate("")}
              editable={!locked}
            />

            <View style={styles.itemsHeader}>
              <Text style={styles.itemsTitle}>Items Purchased</Text>
              {!locked && (
                <Pressable onPress={addItem} hitSlop={8}>
                  <Text style={styles.addLink}>+ Add item</Text>
                </Pressable>
              )}
            </View>

            {items.length === 0 && (
              <Text style={styles.emptyItems}>
                {locked
                  ? "No items recorded."
                  : "No items detected yet — add them manually if needed."}
              </Text>
            )}

            {items.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <TextInput
                  style={[styles.itemInput, styles.itemName]}
                  placeholder="Item name"
                  value={item.name}
                  editable={!locked}
                  onChangeText={(v) => updateItem(item.id, { name: v })}
                />
                <TextInput
                  style={[styles.itemInput, styles.itemQty]}
                  placeholder="Qty"
                  value={item.quantity}
                  editable={!locked}
                  keyboardType="numeric"
                  onChangeText={(v) => updateItem(item.id, { quantity: v })}
                />
                <TextInput
                  style={[styles.itemInput, styles.itemPrice]}
                  placeholder="₱0.00"
                  value={item.price}
                  editable={!locked}
                  keyboardType="decimal-pad"
                  onChangeText={(v) => updateItem(item.id, { price: v })}
                />
                {!locked && (
                  <Pressable
                    onPress={() => removeItem(item.id)}
                    hitSlop={8}
                    style={styles.removeBtn}
                    accessibilityLabel={`Delete ${item.name || "item"}`}
                  >
                    <Text style={styles.removeText}>✕</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </ScrollView>

          <View style={styles.actions}>
            {!locked ? (
              <>
                <Pressable style={[styles.btn, styles.btnGhost]} onPress={onClose}>
                  <Text style={styles.btnGhostText}>Close</Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.btnPrimary]} onPress={handleConfirm}>
                  <Text style={styles.btnPrimaryText}>Confirm Details</Text>
                </Pressable>
              </>
            ) : (
              <Pressable style={[styles.btn, styles.btnPrimary, { flex: 1 }]} onPress={onClose}>
                <Text style={styles.btnPrimaryText}>Done</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChangeText,
  onClear,
  editable,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  onClear?: () => void;
  editable: boolean;
  keyboardType?: "default" | "decimal-pad" | "numeric";
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldInputRow}>
        <TextInput
          style={[
            styles.fieldInput,
            styles.fieldInputFlex,
            !editable && styles.fieldInputLocked,
          ]}
          value={value}
          editable={editable}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          placeholder={editable ? "Not detected — tap to add" : "—"}
          placeholderTextColor="#B7AF9C"
        />
        {editable && value.length > 0 && onClear && (
          <Pressable
            onPress={onClear}
            hitSlop={8}
            style={styles.fieldClearBtn}
            accessibilityLabel={`Clear ${label}`}
          >
            <Text style={styles.fieldClearText}>✕</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(26,26,26,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
    maxHeight: "88%",
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginBottom: 12,
  },
  title: {
    fontSize: 19,
    fontWeight: "800",
    color: COLORS.ink,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.muted,
    marginTop: 2,
    marginBottom: 14,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  field: {
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.muted,
    marginBottom: 4,
  },
  fieldInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  fieldInput: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: COLORS.ink,
  },
  fieldInputFlex: {
    flex: 1,
  },
  fieldInputLocked: {
    backgroundColor: "#F1ECE2",
    color: COLORS.muted,
  },
  fieldClearBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F6E3E3",
  },
  fieldClearText: {
    color: COLORS.danger,
    fontWeight: "700",
    fontSize: 12,
  },
  itemsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    marginBottom: 8,
  },
  itemsTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.ink,
  },
  addLink: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.accent,
  },
  emptyItems: {
    fontSize: 12,
    color: COLORS.muted,
    fontStyle: "italic",
    marginBottom: 8,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  itemInput: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: COLORS.ink,
  },
  itemName: { flex: 3 },
  itemQty: { flex: 1, textAlign: "center" },
  itemPrice: { flex: 1.4 },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F6E3E3",
  },
  removeText: {
    color: COLORS.danger,
    fontWeight: "700",
    fontSize: 13,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  btn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: "center",
  },
  btnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  btnGhostText: {
    color: COLORS.ink,
    fontWeight: "600",
    fontSize: 14,
  },
  btnPrimary: {
    backgroundColor: COLORS.ink,
  },
  btnPrimaryText: {
    color: "#FFF",
    fontWeight: "700",
    fontSize: 14,
  },
});