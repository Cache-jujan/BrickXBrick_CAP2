import React, { useState } from "react";
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

import { CaptureOptionCard } from "@/components/capture-option-card";
import { FilePreview, type FileState } from "@/components/file-preview";
import { OcrResultModal, type OcrResult } from "@/components/ocr-result-modal";
import { TicketPickerModal, type SelectedTicket } from "@/components/ticket-picker-modal";
import { submitExpense } from "@/lib/api";

// EXPO_PUBLIC_ prefix is required for Expo to bundle an env var into the app —
// anything without that prefix is invisible on device, only on your machine.
import { API_URL, DEV_TOKEN } from "@/constants/api";
console.log("API_URL:", API_URL);
type Status = "idle" | "uploading" | "success" | "error";
type SubmitStatus = "idle" | "submitting" | "success" | "error";

const CATEGORIES = ["Materials", "Equipment", "Other"] as const;
type Category = (typeof CATEGORIES)[number];

function formatBytes(bytes?: number) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

export default function CaptureScreen() {
  const [file, setFile] = useState<FileState>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [resultVisible, setResultVisible] = useState(false);
  // Once true, the modal locks every field permanently for this receipt —
  // this is what enforces "you can only check the extraction once."
  const [confirmed, setConfirmed] = useState(false);
  const [ticketPickerVisible, setTicketPickerVisible] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<SelectedTicket | null>(null);

  // F6.7 — category and quantity aren't derivable from OCR, so they're
  // collected here, after a ticket is linked and before the real submit.
  const [category, setCategory] = useState<Category | null>(null);
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Everything below scales off the *available height*, not a device
  // breakpoint list, so it degrades gracefully on any small phone
  // (iPhone SE, older/cheap Android units, split-screen, etc.) without
  // ever needing a ScrollView — the preview card stays on screen always.
  const { height } = useWindowDimensions();
  const compact = height < 700;
  const tight = height < 620;

  async function handleCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Camera access needed",
        "Enable camera access in Settings to take a photo."
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (!result.canceled) {
      const asset = result.assets[0];
      setFile({ type: "image", name: asset.fileName ?? "photo.jpg", uri: asset.uri });
    }
  }

  async function handleGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Photo access needed", "Enable photo library access in Settings.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    if (!result.canceled) {
      const asset = result.assets[0];
      setFile({ type: "image", name: asset.fileName ?? "photo.jpg", uri: asset.uri });
    }
  }

  async function handlePdf() {
    const result = await DocumentPicker.getDocumentAsync({
      type: "application/pdf",
      copyToCacheDirectory: true,
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      setFile({
        type: "pdf",
        name: asset.name,
        size: formatBytes(asset.size),
        uri: asset.uri,
      });
    }
  }

  async function handleSubmit() {
    if (!file) return;

    setStatus("uploading");
    setErrorMessage(null);

    try {
      const uploadResult = await FileSystem.uploadAsync(
        `${API_URL}/api/receipts/scan`,
        file.uri,
        {
          httpMethod: "POST",
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: "file",
          mimeType: file.type === "image" ? "image/jpeg" : "application/pdf",
          // TODO: replace with real Supabase session token once mobile auth
          // (oauth/callback.tsx) is actually finished — this is a dev-only bypass.
          headers: {
            Authorization: `Bearer ${DEV_TOKEN}`,
          },
        }
      );

      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error(`Server responded ${uploadResult.status}`);
      }

      const data = JSON.parse(uploadResult.body);

      // Backend doesn't extract line items reliably yet — default to an
      // empty list so the modal's items UI has something safe to render.
      setOcrResult({ ...data, items: data.lineItems ?? [] });
      if (data.ocrError) Alert.alert("Heads up", data.ocrError);
      setResultVisible(true);
      setConfirmed(false);
      setStatus("success");
    } catch (err) {
      console.error("Upload failed:", err);

      const message = err instanceof Error ? err.message : String(err);
      const isNetworkError = /network|connect|timed out|unreachable/i.test(message);

      setErrorMessage(
        isNetworkError
          ? `Can't reach the server at ${API_URL}. Make sure the backend is running and your phone is on the same Wi-Fi network as your computer.`
          : "Something went wrong while scanning that receipt. Please try again."
      );
      setStatus("error");
    }
  }

  // F6.7 — the real POST /api/expenses call. Runs after OCR confirm +
  // ticket link + category/quantity are all in place.
  async function handleSubmitExpense() {
    if (!ocrResult || !selectedTicket || !category) return;

    if (!ocrResult.receiptImageURL) {
      // Should not happen post-fix, but fail loudly rather than let the
      // server's 400 be the first sign something's wrong.
      Alert.alert("Missing receipt image", "No receipt image was found for this scan. Please rescan.");
      return;
    }

    const amountNum =
      typeof ocrResult.amount === "number" ? ocrResult.amount : Number(ocrResult.amount);
    if (!Number.isFinite(amountNum)) {
      Alert.alert("Amount required", "Enter a valid amount in the receipt details before submitting.");
      return;
    }

    setSubmitStatus("submitting");
    setSubmitError(null);

    try {
      await submitExpense({
        ticketID: selectedTicket.ticketId,
        vendorName: ocrResult.vendorName,
        amount: amountNum,
        receiptDate: ocrResult.receiptDate,
        category,
        receiptImageURL: ocrResult.receiptImageURL,
        birNumber: ocrResult.birNumber,
        tin: ocrResult.tin,
        birPermitNumber: ocrResult.birPermitNumber,
        lineItems: ocrResult.lineItems ?? [],
        quantity: (ocrResult.lineItems ?? []).reduce((s, i) => s + (i.quantity ?? 1), 0),
      });

      setSubmitStatus("success");
      Alert.alert("Expense submitted", "Your expense was submitted successfully.");
      handleClear();
    } catch (err) {
      console.error("Expense submit failed:", err);
      setSubmitStatus("error");
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleClear() {
    setFile(null);
    setStatus("idle");
    setErrorMessage(null);
    setOcrResult(null);
    setResultVisible(false);
    setConfirmed(false);
    setTicketPickerVisible(false);
    setSelectedTicket(null);
    setCategory(null);
    setSubmitStatus("idle");
    setSubmitError(null);
  }

  const showExpenseCard = selectedTicket && ocrResult && submitStatus !== "success";

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={[styles.container, { padding: tight ? 12 : compact ? 16 : 20 }]}>
        {/* HEADER */}
        <View style={{ marginBottom: tight ? 8 : compact ? 10 : 14 }}>
          <Text style={[styles.title, tight && styles.titleTight]}>
            Upload Documents
          </Text>
          {!tight && (
            <Text style={styles.subtitle}>
              Select a file format below to attach your media assets.
            </Text>
          )}
        </View>

        {/* METHOD SELECTION — stacked cards on tall screens, a compact row on short ones */}
        <View
          style={[
            compact ? styles.optionRow : styles.optionList,
            { marginBottom: tight ? 8 : compact ? 10 : 14 },
          ]}
        >
          <CaptureOptionCard
            title="Use Camera"
            description="Take a new photo of a receipt"
            icon="camera.fill"
            tint="#B94D22"
            iconBackground="#F6E3D8"
            onPress={handleCamera}
            compact={compact}
          />
          <CaptureOptionCard
            title="From Gallery"
            description="Choose an existing photo"
            icon="photo.on.rectangle"
            tint="#2F6F4E"
            iconBackground="#E1EFE7"
            onPress={handleGallery}
            compact={compact}
          />
          <CaptureOptionCard
            title="Upload PDF Document"
            description="Attach a PDF receipt or invoice"
            icon="doc.fill"
            tint="#4A5FBD"
            iconBackground="#E4E7F7"
            onPress={handlePdf}
            compact={compact}
          />
        </View>

        {/* PREVIEW — flex:1 always absorbs remaining space, so this stays
            fully visible on screen no matter how tall/short the device is. */}
        {!tight && <Text style={styles.sectionTitle}>File Status Preview</Text>}
        <View style={styles.previewZone}>
          <FilePreview file={file} />
        </View>

        {/* SUBMIT (scan) */}
        {file && status !== "success" && (
          <TouchableOpacity
            style={[styles.submitButton, tight && styles.buttonTight]}
            onPress={handleSubmit}
            disabled={status === "uploading"}
          >
            <Text style={styles.submitButtonText}>
              {status === "uploading"
                ? "Scanning…"
                : status === "error"
                ? "Try Again"
                : "Submit for OCR"}
            </Text>
          </TouchableOpacity>
        )}

        {/* ERROR (scan) */}
        {status === "error" && errorMessage && (
          <Text style={styles.errorText} numberOfLines={tight ? 2 : undefined}>
            {errorMessage}
          </Text>
        )}

        {/* F6.7 — category/quantity + final submit, shown once a ticket is linked */}
        {showExpenseCard && (
          <View style={styles.expenseCard}>
            <Text style={styles.sectionTitle}>Finalize Expense</Text>
            <Text style={styles.ticketSummary}>
              {selectedTicket!.projectName} — {selectedTicket!.subject}
            </Text>

            <Text style={styles.fieldLabelSmall}>Category</Text>
            <View style={styles.categoryRow}>
              {CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.categoryChip, category === c && styles.categoryChipActive]}
                  onPress={() => setCategory(c)}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      category === c && styles.categoryChipTextActive,
                    ]}
                  >
                    {c}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabelSmall}>Quantity</Text>
            <TextInput
              style={styles.quantityInput}
              keyboardType="numeric"
              placeholder="e.g. 1"
              placeholderTextColor="#B7AF9C"
            />

            {submitStatus === "error" && submitError && (
              <Text style={styles.errorText}>{submitError}</Text>
            )}

            <TouchableOpacity
              style={[
                styles.submitButton,
                (!category || submitStatus === "submitting") && styles.submitButtonDisabled,
              ]}
              onPress={handleSubmitExpense}
              disabled={!category || submitStatus === "submitting"}
            >
              <Text style={styles.submitButtonText}>
                {submitStatus === "submitting" ? "Submitting…" : "Submit Expense"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* CLEAR */}
        {file && (
          <TouchableOpacity
            style={[styles.clearButton, tight && { paddingVertical: 4 }]}
            onPress={handleClear}
          >
            <Text style={styles.clearButtonText}>Clear Selected File</Text>
          </TouchableOpacity>
        )}

        {__DEV__ && !tight && <Text style={styles.debugText}>Server: {API_URL}</Text>}
      </View>

      <OcrResultModal
        visible={resultVisible}
        result={ocrResult}
        locked={confirmed}
        onConfirm={(final) => {
          setOcrResult(final);
          setConfirmed(true);
          setTicketPickerVisible(true); // F6.6 comes right after confirm
        }}
        onClose={() => setResultVisible(false)}
      />

      <TicketPickerModal
        visible={ticketPickerVisible}
        onSelect={(ticket) => {
          setSelectedTicket(ticket);
          setTicketPickerVisible(false);
          // Prefill quantity from OCR if the parser found line items;
          // otherwise leave it blank for manual entry.
              }}
        onClose={() => setTicketPickerVisible(false)}
      />
    </SafeAreaView>
  );
}

const COLORS = {
  bg: "#F8F1E8",
  ink: "#1A1A1A",
  card: "#FFFFFF",
  border: "#EDE6D9",
  muted: "#8A8272",
  danger: "#C1121F",
  accent: "#2F6F4E",
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  container: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.ink,
    marginBottom: 4,
  },
  titleTight: {
    fontSize: 18,
    marginBottom: 0,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.muted,
    lineHeight: 18,
  },
  optionList: {
    gap: 10,
  },
  optionRow: {
    flexDirection: "row",
    gap: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.ink,
    marginBottom: 8,
  },
  previewZone: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderStyle: "dashed",
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: "center",
    alignItems: "center",
    padding: 12,
    overflow: "hidden",
  },
  submitButton: {
    marginTop: 12,
    backgroundColor: COLORS.ink,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  buttonTight: {
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: 12,
  },
  submitButtonText: {
    color: "#FFF",
    fontWeight: "700",
    fontSize: 15,
  },
  errorText: {
    color: COLORS.danger,
    textAlign: "center",
    marginTop: 8,
    fontSize: 12,
    lineHeight: 16,
  },
  clearButton: {
    marginTop: 6,
    alignSelf: "center",
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  clearButtonText: {
    color: COLORS.danger,
    fontWeight: "600",
    fontSize: 13,
  },
  debugText: {
    marginTop: 6,
    textAlign: "center",
    fontSize: 10,
    color: COLORS.muted,
  },
  expenseCard: {
    marginTop: 14,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
  },
  ticketSummary: {
    fontSize: 12,
    color: COLORS.muted,
    marginBottom: 12,
  },
  fieldLabelSmall: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.muted,
    marginBottom: 6,
  },
  categoryRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  categoryChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: "center",
    backgroundColor: COLORS.bg,
  },
  categoryChipActive: {
    backgroundColor: COLORS.ink,
    borderColor: COLORS.ink,
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.ink,
  },
  categoryChipTextActive: {
    color: "#FFF",
  },
  quantityInput: {
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: COLORS.ink,
    marginBottom: 12,
  },
});