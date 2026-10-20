import React, { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as Crypto from "expo-crypto";

import { FilePreview, type FileState } from "@/components/file-preview";
import { FlowHeader } from "@/components/flow-header";
import { LoadingOverlay } from "@/components/loading-overlay";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useNetwork } from "@/lib/sync/network-context";
import { useExpenseDraft } from "@/lib/expense-draft-context";
import { COLORS } from "@/constants/expense-flow-colors";
import { compressReceiptImage } from "@/lib/compress-image";
import { startScan } from "@/lib/receipt-scans";
import { getSession } from "@/lib/auth";
import { queueScan } from "@/lib/sync/db";
import { copyFileToQueue, deleteQueuedPhoto } from "@/lib/sync/task-photo";

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
  const { draft, setFile, setScanID, reset } = useExpenseDraft();
  const [file, setLocalFile] = useState<FileState>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { isOnline, refreshPendingCount } = useNetwork();
  // The server couldn't be reached on the last try: offer to keep it on the phone.
  const [unreachable, setUnreachable] = useState(false);

  const isSplit = draft.mode === "split";
  // Single mode needs a ticket; split mode has none (the server picks the requests).
  if (!draft.ticket && !isSplit) return <Redirect href="/" />;

  // Every new pick starts clean: no leftover "Try again" or error text.
  function pick(next: FileState) {
    setLocalFile(next);
    setStatus("idle");
    setErrorMessage(null);
    setUnreachable(false);
  }

  // Compress once at pick time, so the preview shows exactly what gets
  // uploaded. If compression fails, upload the original rather than block.
  async function pickImage(asset: ImagePicker.ImagePickerAsset) {
    const selected = imageFileFromAsset(asset);
    if (!selected) return Alert.alert("Unsupported image", "Choose a JPG or PNG receipt.");
    try {
      const small = await compressReceiptImage(asset.uri, asset.width, asset.height);
      const baseName = selected.name.replace(/\.[^.]+$/, "");
      pick({ ...selected, uri: small.uri, mimeType: small.mimeType, name: `${baseName}.jpg` });
    } catch (err) {
      console.warn("Image compression failed; uploading the original:", err);
      pick(selected);
    }
  }

  async function handleCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert("Camera access needed", "Enable it in Settings.");
    const result = await ImagePicker.launchCameraAsync({ quality: 1 });
    if (!result.canceled) await pickImage(result.assets[0]);
  }
  async function handleGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert("Photo access needed", "Enable it in Settings.");
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 1 });
    if (!result.canceled) await pickImage(result.assets[0]);
  }
  async function handlePdf() {
    const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (!result.canceled) {
      const a = result.assets[0];
      pick({ type: "pdf", name: a.name, size: formatBytes(a.size), uri: a.uri, mimeType: a.mimeType ?? "application/pdf" });
    }
  }

  // Offline-first: reading a receipt (OCR) happens on the server, so with no
  // connection the file is kept on the phone and uploaded for reading on
  // reconnect (lib/sync/sync.js). It then shows under "Scanned receipts".
  async function saveForLater() {
    if (!file || status === "uploading") return;
    const session = getSession();
    if (!session) return;
    setStatus("uploading");
    setErrorMessage(null);
    let copied: string | null = null;
    try {
      copied = await copyFileToQueue(file.uri, file.name);
      const result = queueScan({
        scanId: Crypto.randomUUID(),
        userId: session.user.id,
        filePath: copied,
        fileName: file.name,
        fileType: file.type,
        mimeType: file.mimeType ?? (file.type === "image" ? "image/jpeg" : "application/pdf"),
        context: { mode: draft.mode, ticket: draft.ticket, fileName: file.name, fileType: file.type },
      });
      if (!result.queued) {
        await deleteQueuedPhoto(copied);
        setErrorMessage(result.message ?? "Couldn't save this receipt on your phone.");
        setStatus("error");
        return;
      }
      refreshPendingCount();
      setStatus("idle");
      Alert.alert(
        "Saved on your phone",
        "It will be uploaded for reading when you're back online. Then it appears under Scanned receipts, ready to review."
      );
      reset();
      router.replace("/");
    } catch (err) {
      if (copied) await deleteQueuedPhoto(copied);
      setErrorMessage("Couldn't save this receipt on your phone. Please try again.");
      setStatus("error");
    }
  }

  // Only the upload happens here. OCR runs on the server in the background,
  // so the user can leave the scanning screen or close the app.
  async function handleSubmit() {
    if (!file || status === "uploading") return;
    if (!isOnline) return saveForLater();
    setUnreachable(false);
    setStatus("uploading"); setErrorMessage(null);
    try {
      const scan = await startScan(file, { mode: draft.mode, ticket: draft.ticket, fileName: file.name, fileType: file.type });
      setFile(file);
      setScanID(scan.scanID);
      setStatus("idle");
      router.replace({ pathname: "/expense/scanning", params: { id: scan.scanID } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isNetworkError = /network|connect|timed out|unreachable/i.test(message);
      if (isNetworkError && !isOnline) {
        // The connection dropped mid-upload: keep it on the phone instead.
        setStatus("idle");
        return saveForLater();
      }
      setUnreachable(isNetworkError);
      setErrorMessage(
        isNetworkError
          ? "Can't reach the server right now. Try again, or save it on your phone and it uploads by itself later."
          : "Something went wrong while uploading. Please try again."
      );
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
          {status === "error" && errorMessage ? (
            <Text style={styles.errorText}>{errorMessage}</Text>
          ) : !isOnline ? (
            <Text style={styles.offlineText}>
              You're offline. The receipt will be saved on your phone and uploaded for reading when you're back online.
            </Text>
          ) : null}
          <Pressable
            style={({ pressed }) => [styles.submitButton, pressed && styles.pressed]}
            onPress={handleSubmit}
            disabled={status === "uploading"}
            accessibilityRole="button"
          >
            <Text style={styles.submitButtonText}>
              {!isOnline ? "Save to upload later" : status === "error" ? "Try again" : "Scan receipt"}
            </Text>
          </Pressable>
          {isOnline && unreachable && (
            <Pressable onPress={saveForLater} style={styles.secondaryButton} accessibilityRole="button">
              <Text style={styles.secondaryButtonText}>Save on phone instead</Text>
            </Pressable>
          )}
        </View>
      )}

      <LoadingOverlay visible={status === "uploading"} message="Uploading receipt…" detail="Keep the app open until the upload finishes." />
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
  offlineText: { color: "#7A4B00", textAlign: "center", marginBottom: 8, fontSize: 13, lineHeight: 18 },
  secondaryButton: { alignItems: "center", borderColor: COLORS.primary, borderRadius: 14, borderWidth: 1, marginTop: 10, paddingVertical: 13 },
  secondaryButtonText: { color: COLORS.primary, fontSize: 15, fontWeight: "700" },
});
