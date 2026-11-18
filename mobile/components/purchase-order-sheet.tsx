import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Print from "expo-print";

import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { AppButton } from "@/components/app-button";
import { BottomSheet } from "@/components/bottom-sheet";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { fetchPoNumber, type OpenRequest } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { formatQty } from "@/lib/money";
import { downloadPo, openPo, sharePo, writePoToCache, type PoFile } from "@/lib/po-file";
import { groupByProject } from "@/lib/project-groups";
import { buildPurchaseOrder, renderPurchaseOrderHtml } from "@/lib/purchase-order";
import { useLocale } from "@/lib/i18n-context";
import { useNetwork } from "@/lib/sync/network-context";

type Props = {
  visible: boolean;
  requests: OpenRequest[];
  /** The project ticked when the sheet opens (the To Buy filter); null = all of them. */
  initialProjectId: string | null;
  onClose: () => void;
};

// "Purchase order", in two steps. 1) Pick the projects and make the PDF. 2) The PDF is ready: Download it to
// the phone, then Open it, Share it, or finish. The PDF is built on this phone from the open requests;
// only its number comes from the server.
export function PurchaseOrderSheet({ visible, requests, initialProjectId, onClose }: Props) {
  const { t, formatDate } = useLocale();
  const { isOnline } = useNetwork();
  const projects = useMemo(
    () => groupByProject(
      requests.filter((r) => Number(r.remainingQuantity) > 0),
      (r: OpenRequest) => ({ id: r.projectID, name: r.projectName, at: r.createdAt })
    ),
    [requests]
  );
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Step 2: the finished PDF. null = still picking projects.
  const [file, setFile] = useState<PoFile | null>(null);

  // Each time the sheet opens: back to step 1, everything ticked, or just the project the list is filtered to.
  useEffect(() => {
    if (!visible) return;
    setProblem(null);
    setFile(null);
    setPicked(initialProjectId && projects.some((p) => p.projectId === initialProjectId)
      ? [initialProjectId]
      : projects.map((p) => p.projectId));
  }, [visible, initialProjectId, projects]);

  const chosen = projects.filter((p) => picked.includes(p.projectId));
  const itemCount = chosen.reduce((sum, p) => sum + p.count, 0);

  function toggle(projectId: string) {
    setProblem(null);
    setPicked((prev) => (prev.includes(projectId) ? prev.filter((id) => id !== projectId) : [...prev, projectId]));
  }

  async function create() {
    if (chosen.length === 0) return setProblem(t("po.pick_one"));
    if (!isOnline) return setProblem(t("po.need_online"));
    setBusy(true);
    setProblem(null);
    // Which step failed decides the message: the number comes from the server, the PDF is made on this phone.
    let step: "number" | "pdf" = "number";
    try {
      const poNumber = await fetchPoNumber();
      step = "pdf";
      const html = renderPurchaseOrderHtml(buildPurchaseOrder(chosen.flatMap((p) => p.items as OpenRequest[])), {
        poNumber,
        dateText: formatDate(new Date(), { day: "numeric", month: "long", year: "numeric" }),
        preparedBy: getSession()?.user.name ?? "",
        formatQty,
        labels: {
          title: t("po.doc_title"), date: t("po.doc_date"), preparedBy: t("po.doc_prepared_by"),
          project: t("po.doc_project"), item: t("po.doc_item"), quantity: t("po.doc_qty"),
          unit: t("po.doc_unit"), store: t("po.doc_store"),
        },
      });
      // A4 in points.
      const printed = await Print.printToFileAsync({ html, width: 595, height: 842, base64: true });
      if (!printed.base64) throw new Error("expo-print returned no PDF data");
      setFile(await writePoToCache(poNumber, printed.base64));
    } catch (err) {
      console.warn("[purchase-order]", step, err);
      setProblem(t(step === "number" ? "po.failed" : "po.failed_pdf"));
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      const savedUri = await downloadPo(file);
      if (savedUri) setFile({ ...file, savedUri });
    } catch (err) {
      console.warn("[purchase-order] download", err);
      setProblem(t("po.download_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function open() {
    if (!file) return;
    setProblem(null);
    try {
      await openPo(file);
    } catch (err) {
      console.warn("[purchase-order] open", err);
      setProblem(t("po.no_viewer"));
    }
  }

  async function share() {
    if (!file) return;
    setProblem(null);
    try {
      await sharePo(file, `${t("po.doc_title")} ${file.poNumber}`);
    } catch (err) {
      console.warn("[purchase-order] share", err);
      setProblem(t("po.failed_pdf"));
    }
  }

  const downloaded = !!file?.savedUri;

  return (
    <BottomSheet
      visible={visible}
      onClose={busy ? () => {} : onClose}
      title={file ? t("po.ready_title", { number: file.poNumber }) : t("po.sheet_title")}
      top={<Text style={styles.help}>{file ? t(downloaded ? "po.saved_help" : "po.ready_help") : t("po.sheet_help")}</Text>}
      footer={
        <View style={styles.footer}>
          {problem ? <Text style={styles.problem} accessibilityRole="alert">{problem}</Text> : null}
          {!file ? (
            <AppButton
              label={chosen.length > 0 ? t("po.create_n", { count: itemCount }) : t("po.create")}
              onPress={create}
              loading={busy}
              disabled={chosen.length === 0}
            />
          ) : !downloaded ? (
            <>
              <AppButton label={t("po.download")} onPress={download} loading={busy} />
              <View style={styles.buttonRow}>
                <AppButton label={t("po.share")} variant="secondary" onPress={share} style={styles.rowButton} />
                <AppButton label={t("po.done")} variant="secondary" onPress={onClose} style={styles.rowButton} />
              </View>
            </>
          ) : (
            <>
              <AppButton label={t("po.open")} onPress={open} />
              <View style={styles.buttonRow}>
                <AppButton label={t("po.share")} variant="secondary" onPress={share} style={styles.rowButton} />
                <AppButton label={t("po.done")} variant="secondary" onPress={onClose} style={styles.rowButton} />
              </View>
            </>
          )}
        </View>
      }
    >
      {file ? (
        <View style={styles.fileCard} accessibilityLabel={file.poNumber}>
          <View style={styles.fileIcon}>
            <IconSymbol name="doc.fill" size={26} color={COLORS.primary} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.rowText}>{file.poNumber}.pdf</Text>
            <Text style={styles.rowHelp}>{downloaded ? t("po.saved_label") : t("po.not_saved_label")}</Text>
          </View>
        </View>
      ) : (
        projects.map((project) => {
          const on = picked.includes(project.projectId);
          return (
            <Pressable
              key={project.projectId}
              onPress={() => toggle(project.projectId)}
              style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && { opacity: 0.85 }]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
            >
              <View style={[styles.box, on && styles.boxOn]}>
                {on ? <IconSymbol name="checkmark.circle.fill" size={18} color="#FFFFFF" /> : null}
              </View>
              <View style={styles.flex}>
                <Text style={styles.rowText} numberOfLines={2}>{project.projectName}</Text>
                <Text style={styles.rowHelp}>{t(project.count === 1 ? "tb.items_one" : "tb.items_other", { count: project.count })}</Text>
              </View>
            </Pressable>
          );
        })
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  help: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.muted, lineHeight: 19 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: MIN_TAP + 12, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: COLORS.card },
  rowOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryTint },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: COLORS.inputBorder, alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  rowText: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.heading },
  rowHelp: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 2 },
  fileCard: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 14, backgroundColor: COLORS.card },
  fileIcon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.primaryTint },
  footer: { gap: 8, paddingTop: 2 },
  buttonRow: { flexDirection: "row", gap: 10 },
  rowButton: { flex: 1 },
  problem: { fontSize: 13, fontFamily: FONT.semibold, color: COLORS.errorText },
});
