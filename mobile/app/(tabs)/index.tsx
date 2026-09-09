import React, { useState } from "react";
import {
  Alert,
  StyleSheet,
  Text,
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

// EXPO_PUBLIC_ prefix is required for Expo to bundle an env var into the app —
// anything without that prefix is invisible on device, only on your machine.
import { API_URL } from "@/constants/api";
console.log("API_URL:", API_URL);
type Status = "idle" | "uploading" | "success" | "error";

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
        }
      );

      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error(`Server responded ${uploadResult.status}`);
      }

      const data = JSON.parse(uploadResult.body);

      // Backend doesn't extract line items yet — default to an empty list
      // so the modal's items UI has something safe to render either way.
      setOcrResult({ ...data.parsed, items: data.parsed.items ?? [] });
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

  function handleClear() {
    setFile(null);
    setStatus("idle");
    setErrorMessage(null);
    setOcrResult(null);
    setResultVisible(false);
    setConfirmed(false);
  }

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

        {/* SUBMIT */}
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

        {/* ERROR */}
        {status === "error" && errorMessage && (
          <Text style={styles.errorText} numberOfLines={tight ? 2 : undefined}>
            {errorMessage}
          </Text>
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
          // TODO: once there's a backend endpoint to persist corrected receipts,
          // POST `final` to it here.
          console.log("Confirmed receipt data:", final);
        }}
        onClose={() => setResultVisible(false)}
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
});