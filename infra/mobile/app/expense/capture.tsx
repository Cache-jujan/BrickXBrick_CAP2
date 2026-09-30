import React, { useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

import { CaptureOptionCard } from "@/components/capture-option-card";
import { FilePreview, type FileState } from "@/components/file-preview";
import { useExpenseDraft } from "@/lib/expense-draft-context";
import { COLORS } from "@/constants/expense-flow-colors";
import { API_URL, DEV_TOKEN } from "@/constants/api";

function formatBytes(bytes?: number) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

export default function CaptureScreen() {
  const { draft, setFile, setOcrResult } = useExpenseDraft();
  const [file, setLocalFile] = useState<FileState>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!draft.ticket) return <Redirect href="/" />;

  async function handleCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert("Camera access needed", "Enable it in Settings.");
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (!result.canceled) { const a = result.assets[0]; setLocalFile({ type: "image", name: a.fileName ?? "photo.jpg", uri: a.uri }); }
  }
  async function handleGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert("Photo access needed", "Enable it in Settings.");
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    if (!result.canceled) { const a = result.assets[0]; setLocalFile({ type: "image", name: a.fileName ?? "photo.jpg", uri: a.uri }); }
  }
  async function handlePdf() {
    const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (!result.canceled) { const a = result.assets[0]; setLocalFile({ type: "pdf", name: a.name, size: formatBytes(a.size), uri: a.uri }); }
  }

  async function handleSubmit() {
    if (!file) return;
    setStatus("uploading"); setErrorMessage(null);
    try {
      const uploadResult = await FileSystem.uploadAsync(`${API_URL}/api/receipts/scan`, file.uri, {
        httpMethod: "POST", uploadType: FileSystem.FileSystemUploadType.MULTIPART, fieldName: "file",
        mimeType: file.type === "image" ? "image/jpeg" : "application/pdf",
        headers: { Authorization: `Bearer ${DEV_TOKEN}` },
      });
      if (uploadResult.status < 200 || uploadResult.status >= 300) throw new Error(`Server responded ${uploadResult.status}`);
      const data = JSON.parse(uploadResult.body);
      setFile(file);
      setOcrResult(data);
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
      <View style={styles.container}>
        <Text style={styles.subtitle}>{draft.ticket.subject} · Step 1 of 2</Text>
        <Text style={styles.title}>Receipt Capture</Text>
        <View style={styles.optionRow}>
          <CaptureOptionCard title="Take Photo" icon="camera.fill" tint={COLORS.primary} iconBackground="#FDECE1" onPress={handleCamera} compact />
          <CaptureOptionCard title="From Gallery" icon="photo.on.rectangle" tint={COLORS.success} iconBackground={COLORS.successBg} onPress={handleGallery} compact />
          <CaptureOptionCard title="Upload PDF" icon="doc.fill" tint="#4A5FBD" iconBackground="#E4E7F7" onPress={handlePdf} compact />
        </View>
        <View style={styles.previewZone}><FilePreview file={file} /></View>
        {file && (
          <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} disabled={status === "uploading"}>
            <Text style={styles.submitButtonText}>{status === "uploading" ? "Scanning…" : status === "error" ? "Try Again" : "Continue"}</Text>
          </TouchableOpacity>
        )}
        {status === "error" && errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1, padding: 20 },
  subtitle: { fontSize: 12, color: COLORS.muted, marginBottom: 2 },
  title: { fontSize: 20, fontWeight: "800", color: COLORS.heading, marginBottom: 16 },
  optionRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  previewZone: { flex: 1, backgroundColor: COLORS.card, borderRadius: 16, borderStyle: "dashed", borderWidth: 2, borderColor: COLORS.border, justifyContent: "center", alignItems: "center", padding: 12 },
  submitButton: { marginTop: 14, backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  submitButtonText: { color: "#FFF", fontWeight: "700", fontSize: 15 },
  errorText: { color: "#C1121F", textAlign: "center", marginTop: 8, fontSize: 12 },
});