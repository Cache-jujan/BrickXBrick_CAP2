import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

export type LineItem = {
  id: string;
  name: string;
  quantity: string;
  price: string;
};

export type OcrResult = {
  storeName: string | null;
  tin: string | null;
  orSiNumber: string | null;
  amount: string | null;
  date: string | null;
  items?: LineItem[];
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
  const [storeName, setStoreName] = useState("");
  const [tin, setTin] = useState("");
  const [orSiNumber, setOrSiNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);

  // Re-seed the editable copy whenever a fresh OCR result comes in.
  // We never mutate `result` directly — this local state is what the
  // user edits, and it's what gets handed back via onConfirm.
  useEffect(() => {
    if (!result) return;
    setStoreName(result.storeName ?? "");
    setTin(result.tin ?? "");
    setOrSiNumber(result.orSiNumber ?? "");
    setAmount(result.amount ?? "");
    setDate(result.date ?? "");
    setItems(result.items?.length ? result.items : []);
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

  function handleConfirm() {
    onConfirm({ storeName, tin, orSiNumber, amount, date, items });
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
              : "Check the fields below — you can only edit these once."}
          </Text>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <Field label="Store" value={storeName} onChangeText={setStoreName} editable={!locked} />
            <Field label="TIN" value={tin} onChangeText={setTin} editable={!locked} />
            <Field label="OR/SI #" value={orSiNumber} onChangeText={setOrSiNumber} editable={!locked} />
            <Field
              label="Amount"
              value={amount}
              onChangeText={setAmount}
              editable={!locked}
              keyboardType="decimal-pad"
            />
            <Field label="Date" value={date} onChangeText={setDate} editable={!locked} />

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
  editable,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  editable: boolean;
  keyboardType?: "default" | "decimal-pad" | "numeric";
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, !editable && styles.fieldInputLocked]}
        value={value}
        editable={editable}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholder="—"
      />
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
  fieldInputLocked: {
    backgroundColor: "#F1ECE2",
    color: COLORS.muted,
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