import React, { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

import { FilePreview, type FileState } from "@/components/file-preview";
import { FlowHeader } from "@/components/flow-header";
import { LoadingOverlay } from "@/components/loading-overlay";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useExpenseDraft } from "@/lib/expense-draft-context";
import { COLORS } from "@/constants/expense-flow-colors";
import { API_URL, authHeaders } from "@/constants/api";

function formatBytes(bytes?: number) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

function imageFileFromAsset(asset: { fileName?: string | null; mimeType?: string | null; uri: string }) {
  const inputMime = asset.mimeType?.toLowerCase();
  const extension = asset.fileName?.split(".").pop()?.toLowerCase();
  let mimeType: string | null = null;
  if (inputMime === "image/png" || (!inputMime && extension === "png")) {
    mimeType = "image/png";
  } else if (
    inputMime === "image/jpeg"
    || inputMime === "image/jpg"
    || (!inputMime && (extension === "jpg" || extension === "jpeg"))
  ) {
    mimeType = "image/jpeg";
  } else if (!inputMime && !extension) {
    mimeType = "image/jpeg";
  }

  if (!mimeType) return null;
  return {
    type: "image" as const,
    name: asset.fileName ?? `photo.${mimeType === "image/png" ? "png" : "jpg"}`,
    uri: asset.uri,
    mimeType,
  };
}

export default function CaptureScreen() {
  const { draft, setFile, setOcrResult } = useExpenseDraft();
  const [file, setLocalFile] = useState<FileState>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isSplit = draft.mode === "split";
  // Single mode needs a ticket; split mode has none (the server picks the requests).
  if (!draft.ticket && !isSplit) return <Redirect href="/" />;

  // Every new pick starts clean: no leftover "Try again" or error text.
  function pick(next: FileState) {
    setLocalFile(next);
    setStatus("idle");
    setErrorMessage(null);
  }

  async function handleCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert("Camera access needed", "Enable it in Settings.");
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (!result.canceled) {
      const selected = imageFileFromAsset(result.assets[0]);
      if (!selected) return Alert.alert("Unsupported image", "Choose a JPG or PNG receipt.");
      pick(selected);
    }
  }
  async function handleGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert("Photo access needed", "Enable it in Settings.");
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    if (!result.canceled) {
      const selected = imageFileFromAsset(result.assets[0]);
      if (!selected) return Alert.alert("Unsupported image", "Choose a JPG or PNG receipt.");
      pick(selected);
    }
  }
  async function handlePdf() {
    const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (!result.canceled) {
      const a = result.assets[0];
      pick({ type: "pdf", name: a.name, size: formatBytes(a.size), uri: a.uri, mimeType: a.mimeType ?? "application/pdf" });
    }
  }

  async function handleSubmit() {
    if (!file || status === "uploading") return;
    setStatus("uploading"); setErrorMessage(null);
    try {
      const uploadResult = await FileSystem.uploadAsync(`${API_URL}/api/receipts/scan`, file.uri, {
        httpMethod: "POST", uploadType: FileSystem.FileSystemUploadType.MULTIPART, fieldName: "file",
        mimeType: file.mimeType ?? (file.type === "image" ? "image/jpeg" : "application/pdf"),
        headers: authHeaders(),
      });
      if (uploadResult.status < 200 || uploadResult.status >= 300) throw new Error(`Server responded ${uploadResult.status}`);
      const data = JSON.parse(uploadResult.body);
      setFile(file);
      setOcrResult(data);
      setStatus("idle");
      if (data.ocrError) Alert.alert("Heads up", data.ocrError);
      router.push("/expense/review");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isNetworkError = /network|connect|timed out|unreachable/i.test(message);
      setErrorMessage(isNetworkError ? "Can't reach the server. Check your connection." : "Something went wrong while scanning. Please try again.");
      setStatus("error");
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlowHeader title="Capture receipt" caption={isSplit ? "Split receipt · Step 1 of 3" : "Step 1 of 3"} />

      <View style={styles.container}>
        <View style={styles.contextChip}>
          {isSplit ? (
            <>
              <Text style={styles.contextTitle}>Split receipt</Text>
              <Text style={styles.contextMeta}>One receipt for several open requests. You'll confirm the split later.</Text>
            </>
          ) : (
            <>
              <Text style={styles.contextTitle} numberOfLines={1}>{draft.ticket?.subject}</Text>
              <Text style={styles.contextMeta} numberOfLines={1}>{draft.ticket?.projectName}</Text>
            </>
          )}
        </View>

        {file ? (
          <>
            <View style={styles.previewZone}><FilePreview file={file} /></View>
            <View style={styles.replaceRow}>
              <Text style={styles.replaceLabel}>Wrong file?</Text>
              <Pressable onPress={handleCamera} hitSlop={6}><Text style={styles.replaceLink}>Retake</Text></Pressable>
              <Pressable onPress={handleGallery} hitSlop={6}><Text style={styles.replaceLink}>Gallery</Text></Pressable>
              <Pressable onPress={handlePdf} hitSlop={6}><Text style={styles.replaceLink}>PDF</Text></Pressable>
            </View>
          </>
        ) : (
          <View style={styles.pickZone}>
            <Pressable
              onPress={handleCamera}
              style={({ pressed }) => [styles.primaryPick, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Take a photo of the receipt"
            >
              <IconSymbol name="camera.fill" size={44} color="#FFFFFF" />
              <Text style={styles.primaryPickText}>Take photo</Text>
              <Text style={styles.primaryPickHint}>Lay the receipt flat, fill the frame</Text>
            </Pressable>
            <View style={styles.secondaryRow}>
              <Pressable onPress={handleGallery} style={({ pressed }) => [styles.secondaryPick, pressed && styles.pressed]} accessibilityRole="button">
                <IconSymbol name="photo.on.rectangle" size={20} color={COLORS.heading} />
                <Text style={styles.secondaryPickText}>Gallery</Text>
              </Pressable>
              <Pressable onPress={handlePdf} style={({ pressed }) => [styles.secondaryPick, pressed && styles.pressed]} accessibilityRole="button">
                <IconSymbol name="doc.fill" size={20} color={COLORS.heading} />
                <Text style={styles.secondaryPickText}>PDF</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {file && (
        <View style={styles.footer}>
          {status === "error" && errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
          <Pressable
            style={({ pressed }) => [styles.submitButton, pressed && styles.pressed]}
            onPress={handleSubmit}
            disabled={status === "uploading"}
            accessibilityRole="button"
          >
            <Text style={styles.submitButtonText}>{status === "error" ? "Try again" : "Scan receipt"}</Text>
          </Pressable>
        </View>
      )}

      <LoadingOverlay visible={status === "uploading"} message="Reading receipt…" detail="Uploading and extracting the details." />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1, paddingHorizontal: 16 },
  contextChip: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 14 },
  contextTitle: { fontSize: 14, fontWeight: "700", color: COLORS.heading },
  contextMeta: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  pickZone: { flex: 1, gap: 12, paddingBottom: 16 },
  primaryPick: { flex: 1, maxHeight: 320, backgroundColor: COLORS.primary, borderRadius: 20, alignItems: "center", justifyContent: "center", gap: 8 },
  primaryPickText: { color: "#FFFFFF", fontSize: 20, fontWeight: "800" },
  primaryPickHint: { color: "rgba(255,255,255,0.85)", fontSize: 13 },
  secondaryRow: { flexDirection: "row", gap: 12 },
  secondaryPick: { flex: 1, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, paddingVertical: 14 },
  secondaryPickText: { fontSize: 15, fontWeight: "700", color: COLORS.heading },
  pressed: { opacity: 0.85 },
  previewZone: { flex: 1, backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, justifyContent: "center", alignItems: "center", padding: 8 },
  replaceRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, paddingVertical: 12 },
  replaceLabel: { fontSize: 13, color: COLORS.muted },
  replaceLink: { fontSize: 13, fontWeight: "700", color: COLORS.primary },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.bg },
  submitButton: { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  submitButtonText: { color: "#FFF", fontWeight: "700", fontSize: 16 },
  errorText: { color: "#C1121F", textAlign: "center", marginBottom: 8, fontSize: 13 },
});
