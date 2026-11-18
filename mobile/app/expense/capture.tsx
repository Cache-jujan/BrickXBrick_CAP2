import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as Crypto from "expo-crypto";

import { FilePreview, type FileState } from "@/components/file-preview";
import { FlowHeader } from "@/components/flow-header";
import { LoadingOverlay } from "@/components/loading-overlay";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useNetwork } from "@/lib/sync/network-context";
import { useExpenseDraft, type DraftMode } from "@/lib/expense-draft-context";
import { COLORS, FONT } from "@/constants/expense-flow-colors";
import { compressReceiptImage } from "@/lib/compress-image";
import { startScan } from "@/lib/receipt-scans";
import { expediteNotificationChecks } from "@/lib/notification-events";
import { PDF_MIME_TYPE, formatBytes, receiptFileProblem, receiptMimeType } from "@/lib/receipt-file";
import { getSession } from "@/lib/auth";
import { formatPeso } from "@/lib/money";
import { useLocale } from "@/lib/i18n-context";
import { queueScan } from "@/lib/sync/db";
import { copyFileToQueue, deleteQueuedPhoto } from "@/lib/sync/task-photo";

type ProjectChoice = { id: string; name: string };

export default function CaptureScreen() {
  const { t } = useLocale();
  const { draft, setFile, setScanID, reset } = useExpenseDraft();
  const [file, setLocalFile] = useState<FileState>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Why the last picked file was refused (wrong type, too big).
  const [pickError, setPickError] = useState<string | null>(null);
  const { isOnline, refreshPendingCount } = useNetwork();
  // The server couldn't be reached on the last try: offer to keep it on the phone.
  const [unreachable, setUnreachable] = useState(false);

  // A receipt with no request picked ("snap now") is matched to the open requests later,
  // at Turn In. Only a receipt opened from one request keeps that request.
  const mode: DraftMode = draft.ticket && draft.mode === "single" ? "single" : "split";
  const isSplit = mode === "split";
  // The Purchaser's receipts wait on Turn In; a Site Manager has no such tab and stays on their list.
  const isSiteManager = getSession()?.user.role === "Site Manager";
  const afterSnap = isSiteManager ? "/" : "/turn-in";

  // The Purchaser does not choose a project here. The receipt is scanned first and matched to the open
  // requests (in every project they can see) once it has been read.
  const scanScope = draft.scope;

  // What the app needs to pick this receipt up again, including the projects it was scanned for.
  function scanContext(picked: NonNullable<FileState>) {
    return {
      mode,
      ticket: isSplit ? null : draft.ticket,
      fileName: picked.name,
      fileType: picked.type,
      ...(isSplit && scanScope ? { projectIds: scanScope.projectIds, projectNames: scanScope.projectNames } : {}),
    };
  }

  // Every new pick starts clean: no leftover "Try again" or error text.
  function pick(next: FileState) {
    setLocalFile(next);
    setStatus("idle");
    setErrorMessage(null);
    setUnreachable(false);
    setPickError(null);
  }

  // Compress once at pick time, so the preview shows exactly what gets
  // uploaded. If compression fails, upload the original rather than block.
  async function pickImage(asset: ImagePicker.ImagePickerAsset) {
    // The camera often reports no type at all; it always produces a JPEG.
    const mimeType = receiptMimeType(asset.mimeType, asset.fileName) ?? "image/jpeg";
    const problem = receiptFileProblem(mimeType, null, t);
    if (problem) return setPickError(problem);

    const name = asset.fileName ?? "photo.jpg";
    try {
      // The upload is a small JPEG whatever the source (JPEG, PNG or WebP).
      const small = await compressReceiptImage(asset.uri, asset.width, asset.height);
      const baseName = name.replace(/\.[^.]+$/, "");
      pick({ type: "image", name: `${baseName}.jpg`, uri: small.uri, mimeType: small.mimeType });
    } catch (err) {
      console.warn("Image compression failed; uploading the original:", err);
      // The original is uploaded as it is, so it must fit the size limit.
      const tooBig = receiptFileProblem(mimeType, asset.fileSize, t);
      if (tooBig) return setPickError(tooBig);
      pick({ type: "image", name, uri: asset.uri, mimeType });
    }
  }

  async function handleCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert(t("mx.camera_needed_title"), t("mx.enable_settings"));
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
    if (!result.canceled) await pickImage(result.assets[0]);
  }
  async function handleGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert(t("mx.photo_needed_title"), t("mx.enable_settings"));
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    if (!result.canceled) await pickImage(result.assets[0]);
  }
  async function handlePdf() {
    const result = await DocumentPicker.getDocumentAsync({ type: PDF_MIME_TYPE, copyToCacheDirectory: true });
    if (result.canceled) return;
    const a = result.assets[0];
    const mimeType = receiptMimeType(a.mimeType, a.name);
    // Only PDFs belong here; the gallery button is for photos.
    const problem = mimeType === PDF_MIME_TYPE ? receiptFileProblem(mimeType, a.size, t) : t("mx.not_pdf");
    if (problem) return setPickError(problem);
    pick({ type: "pdf", name: a.name, size: formatBytes(a.size), uri: a.uri, mimeType: PDF_MIME_TYPE });
  }

  // The Purchaser may have a pile of receipts to scan, so after each one the app says it is on its way and
  // asks: stay here and snap the next (the default; tapping outside does the same), or go to Scanned to review.
  // Every receipt waits in Scanned in the order it was sent, so scanning several in a row queues them there.
  function askSnapNextOrGo(title: string, body: string) {
    Alert.alert(
      title,
      body,
      [
        { text: t("mx.go_scanned"), style: "cancel", onPress: () => { reset(); router.replace(afterSnap); } },
        { text: t("mx.snap_another") },
      ],
      { cancelable: true }
    );
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
        context: scanContext(file),
      });
      if (!result.queued) {
        await deleteQueuedPhoto(copied);
        setErrorMessage(result.message ?? t("mx.save_failed"));
        setStatus("error");
        return;
      }
      refreshPendingCount();
      setStatus("idle");
      // A receipt scanned with no request picked (the normal case) stays on this screen, ready for the next one.
      if (isSplit) {
        pick(null);
        if (isSiteManager) Alert.alert(t("mx.saved_phone_title"), t("mx.saved_phone_body"));
        else askSnapNextOrGo(t("mx.saved_phone_title"), t("mx.saved_phone_body"));
        return;
      }
      Alert.alert(t("mx.saved_phone_title"), t("mx.saved_phone_body"));
      reset();
      router.replace(afterSnap);
    } catch (err) {
      if (copied) await deleteQueuedPhoto(copied);
      setErrorMessage(t("mx.save_failed_retry"));
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
      const scan = await startScan(file, scanContext(file));
      expediteNotificationChecks(); // the "receipt ready" pop-up checks often for the next minute
      setStatus("idle");
      if (isSplit && isSiteManager) {
        // A Site Manager stays on this capture screen, ready for the next receipt.
        pick(null);
        Alert.alert(t("mx.sent_title"), t("mx.sent_body"));
        return;
      }
      if (!isSiteManager) {
        // Snap now, review later: the receipt goes to the Scanned list and OCR runs there.
        // A receipt picked from one request keeps that request (it is in the scan context) and goes straight to Scanned.
        if (isSplit) {
          pick(null);
          askSnapNextOrGo(t("mx.sent_title"), t("mx.sent_body_next"));
          return;
        }
        reset();
        router.replace(afterSnap);
        return;
      }
      setFile(file);
      setScanID(scan.scanID);
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
        isNetworkError ? t("mx.err_server") : t("mx.err_upload")
      );
      setStatus("error");
    }
  }

  const tips = [t("mx.tip_flat"), t("mx.tip_edges"), t("mx.tip_light")];

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlowHeader
        title={!isSplit && draft.ticket?.subject ? draft.ticket.subject : t("ti.title")}
        caption={t("mx.step_n", { current: 1, total: 3 })}
        step={{ current: 1, total: 3 }}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!isSplit && (
          <View style={styles.contextChip}>
            <Text style={styles.contextTitle} numberOfLines={1}>{draft.ticket?.subject}</Text>
            <Text style={styles.contextMeta} numberOfLines={1}>{draft.ticket?.projectName}</Text>
            {draft.ticket?.remaining != null ? (
              <Text style={styles.contextMeta} numberOfLines={2}>{t("bd.left", { remaining: formatPeso(draft.ticket.remaining) })}</Text>
            ) : null}
          </View>
        )}

        <View style={[styles.dropArea, file && styles.dropAreaFilled]}>
          {file ? (
            <FilePreview file={file} />
          ) : (
            <>
              <View style={styles.dropIcon}>
                <IconSymbol name="doc.fill" size={30} color={COLORS.primary} />
              </View>
              <Text style={styles.dropTitle}>{t("mx.drop_title")}</Text>
              <Text style={styles.dropBody}>{t("mx.drop_body")}</Text>
              {/* What is accepted, before picking (same rule as lib/receipt-file.ts and the backend). */}
              <Text style={styles.fileRules}>{t("mx.file_rules")}</Text>
            </>
          )}
        </View>

        {pickError ? (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorBoxText}>{pickError}</Text>
          </View>
        ) : null}

        {!file && (
          <View style={styles.tips}>
            <Text style={styles.tipsTitle}>{t("mx.good_scan")}</Text>
            {tips.map((tip) => (
              <View key={tip} style={styles.tipRow}>
                <IconSymbol name="checkmark.circle.fill" size={16} color={COLORS.success} />
                <Text style={styles.tipText}>{tip}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {file && status === "error" && errorMessage ? (
          <Text style={styles.errorText}>{errorMessage}</Text>
        ) : file && !isOnline ? (
          <Text style={styles.offlineText}>{t("mx.offline_note")}</Text>
        ) : null}

        {file && (
          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            onPress={handleSubmit}
            disabled={status === "uploading"}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>
              {!isOnline ? t("mx.save_later") : status === "error" ? t("common.try_again") : t("mx.scan_receipt")}
            </Text>
          </Pressable>
        )}
        {file && isOnline && unreachable && (
          <Pressable onPress={saveForLater} style={styles.outlinedButton} accessibilityRole="button">
            <Text style={styles.outlinedButtonText}>{t("mx.save_phone_instead")}</Text>
          </Pressable>
        )}

        {/* Taking the photo is the main way in; picking an existing file is the backup. */}
        <Pressable
          onPress={handleCamera}
          style={({ pressed }) => [file ? styles.outlinedButton : styles.primaryButton, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={file ? styles.outlinedButtonText : styles.primaryButtonText}>{t("mx.take_photo")}</Text>
        </Pressable>
        <View style={styles.buttonRow}>
          <Pressable
            onPress={handleGallery}
            style={({ pressed }) => [styles.rowButton, styles.outlinedButton, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.outlinedButtonText}>{t("mx.gallery")}</Text>
          </Pressable>
          <Pressable
            onPress={handlePdf}
            style={({ pressed }) => [styles.rowButton, styles.outlinedButton, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.outlinedButtonText}>{t("mx.upload_pdf")}</Text>
          </Pressable>
        </View>
      </View>

      <LoadingOverlay visible={status === "uploading"} message={t("mx.uploading_receipt")} detail={t("mx.keep_open")} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  content: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 12 },
  contextChip: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 12 },
  contextTitle: { fontSize: 14, fontFamily: FONT.bold, color: COLORS.heading },
  contextMeta: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 2 },

  dropArea: { minHeight: 220, alignItems: "center", justifyContent: "center", gap: 8, padding: 20, borderRadius: 16, borderWidth: 1.5, borderStyle: "dashed", borderColor: COLORS.inputBorder, backgroundColor: COLORS.card },
  dropAreaFilled: { borderStyle: "solid", borderColor: COLORS.border, padding: 8, minHeight: 280 },
  dropIcon: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.card },
  dropTitle: { fontSize: 16, fontFamily: FONT.extrabold, color: COLORS.heading, textAlign: "center" },
  dropBody: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.muted, textAlign: "center", lineHeight: 19 },
  fileRules: { fontSize: 12, fontFamily: FONT.semibold, color: COLORS.muted, textAlign: "center", marginTop: 6 },

  errorBox: { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.errorBorder, backgroundColor: COLORS.errorFill },
  errorBoxText: { fontSize: 13, fontFamily: FONT.medium, color: COLORS.errorText, lineHeight: 18 },

  tips: { marginTop: 16, gap: 8 },
  tipsTitle: { fontSize: 13, fontFamily: FONT.bold, color: COLORS.heading },
  tipRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tipText: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.muted },

  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, gap: 10, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.card },
  buttonRow: { flexDirection: "row", gap: 10 },
  rowButton: { flex: 1 },
  primaryButton: { minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, backgroundColor: COLORS.primary },
  primaryButtonText: { color: "#FFFFFF", fontSize: 15, fontFamily: FONT.bold, textAlign: "center" },
  outlinedButton: { minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: COLORS.card },
  outlinedButtonText: { color: COLORS.primary, fontSize: 15, fontFamily: FONT.bold, textAlign: "center" },
  pressed: { opacity: 0.85 },

  errorText: { color: COLORS.errorText, textAlign: "center", fontSize: 13, fontFamily: FONT.regular },
  offlineText: { color: COLORS.amberText, textAlign: "center", fontSize: 13, fontFamily: FONT.regular, lineHeight: 18 },
});
