// allocate.tsx — "Check receipt": the last step for a receipt that is not tied to one request.
//
// The Purchaser's job here is small: confirm which requests the receipt paid for (the app
// has already ticked the ones that match) and, only when they spent past what the PM gave or
// bought more than was requested, say why in a few words. The split maths stays on the
// server; the Project Manager sees the reason and decides.
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import * as Crypto from "expo-crypto";

import { useExpenseDraft } from "@/lib/expense-draft-context";
import { dismissScan } from "@/lib/receipt-scans";
import {
  ApiError,
  previewAllocation,
  submitAllocation,
  type AllocationPlan,
  type AllocationResult,
  type SplitLine,
} from "@/lib/api";
import { formatPeso, formatQty } from "@/lib/money";
import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { FlowHeader } from "@/components/flow-header";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { LoadingOverlay } from "@/components/loading-overlay";
import { ProjectGroup } from "@/components/project-group";
import { StatusChip } from "@/components/status-chip";
import { groupByProject, outOfScopeTicketIDs, tickState } from "@/lib/project-groups";
import { loadOpenRequests } from "@/lib/cached-api";
import { describeLoadError } from "@/lib/sync/messages";
import { useNetwork } from "@/lib/sync/network-context";
import { useLocale } from "@/lib/i18n-context";

type KnownTicket = { ticketID: string; projectID: string; projectName: string; materialType: string };

// The note is read by the Project Manager, so it is always saved in English.
const REASONS = [
  { key: "price", labelKey: "ck.reason_price", text: "Prices went up." },
  { key: "delivery", labelKey: "ck.reason_delivery", text: "Delivery or gas." },
  { key: "promo", labelKey: "ck.reason_promo", text: "The store gave extra." },
] as const;

const RED = COLORS.errorText;
const RED_BG = COLORS.errorFill;
const AMBER = COLORS.amberText;
const AMBER_BG = COLORS.amberBannerFill;

export default function AllocateScreen() {
  const { t, formatDate } = useLocale();
  const { draft, setCategory: setDraftCategory, reset } = useExpenseDraft();
  const { ocrResult, scope } = draft;

  const [excluded, setExcluded] = useState<string[]>([]);
  // Scanned for certain projects: the other projects' requests are left out of the match.
  // null until the open requests are known, so the first preview already respects the scope.
  const [outOfScope, setOutOfScope] = useState<string[] | null>(scope ? null : []);
  // The project row that is open. undefined = automatic (a lone project opens itself); null = all closed.
  const [openProject, setOpenProject] = useState<string | null | undefined>(undefined);
  const [plan, setPlan] = useState<AllocationPlan | null>(null);
  const [known, setKnown] = useState<Record<string, KnownTicket>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { isOnline } = useNetwork();
  // Back online: run the preview again.
  const wasOnline = React.useRef(isOnline);
  useEffect(() => {
    if (isOnline && !wasOnline.current) setRefreshKey((k) => k + 1);
    wasOnline.current = isOnline;
  }, [isOnline]);
  const [reasonKey, setReasonKey] = useState<(typeof REASONS)[number]["key"] | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitProblems, setSubmitProblems] = useState<string[]>([]);
  const [result, setResult] = useState<AllocationResult | null>(null);
  // One ID for this receipt, kept across retries, so a lost response cannot save it twice.
  const commonReceiptID = React.useRef(Crypto.randomUUID()).current;

  // The confirmed lines from the Review screen, in receipt order.
  const lineItems: SplitLine[] = useMemo(
    () => (ocrResult?.lineItems ?? []).map((li) => ({
      description: li.description,
      quantity: Number(li.quantity),
      amount: Number(li.amount),
      bomItemID: li.bomItemID ?? null,
    })),
    [ocrResult]
  );

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    loadOpenRequests()
      .then((open) => { if (!cancelled) setOutOfScope(outOfScopeTicketIDs(open.data, scope.projectIds)); })
      .catch(() => { if (!cancelled) setOutOfScope([]); });
    return () => { cancelled = true; };
  }, [scope]);

  // Lines matched to a request by hand in Review receipt: { receipt line number: ticketID }.
  const lineTargets = useMemo(
    () =>
      Object.fromEntries(
        (ocrResult?.lineItems ?? []).flatMap((li, index) => (li.matchedTicketID ? [[String(index), li.matchedTicketID]] : []))
      ) as Record<string, string>,
    [ocrResult]
  );

  // Re-run the preview whenever the Purchaser ticks or unticks a request.
  useEffect(() => {
    if (!ocrResult || result || outOfScope === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    previewAllocation(lineItems, { excludeTicketIDs: [...outOfScope, ...excluded], feeTargets: {}, lineTargets })
      .then((next) => {
        if (cancelled) return;
        setPlan(next);
        // Remember every request seen, so an unticked one stays on screen to tick again.
        setKnown((prev) => {
          const merged = { ...prev };
          for (const p of next.portions) {
            merged[p.ticketID] = { ticketID: p.ticketID, projectID: p.projectID, projectName: p.projectName, materialType: p.materialType };
          }
          return merged;
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setPlan(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lineItems, excluded, outOfScope, lineTargets, refreshKey, ocrResult, result]);

  // All hooks are above this line.
  if (!ocrResult || draft.mode !== "split") return <Redirect href="/" />;

  const receipt = ocrResult;
  const portions = plan?.portions ?? [];
  const unticked = excluded.filter((id) => !portions.some((p) => p.ticketID === id));
  const receiptTotal = Number(receipt.amount);

  // Anything that needs a few words from the Purchaser before the PM sees it.
  const extras = portions.filter((p) => p.extraQuantity > 0);
  const overspent = portions.filter((p) => p.overAllowance);
  const needsReason = extras.length > 0 || overspent.length > 0;
  const reason = [REASONS.find((r) => r.key === reasonKey)?.text, details.trim()].filter(Boolean).join(" ");
  const reasonOk = !needsReason || reason.length > 0;

  const missing = [...(plan?.unmatched ?? [])];
  const canSubmit = !!plan?.ok && reasonOk && !loading && !submitting;

  function toggle(ticketID: string, ticked: boolean) {
    setSubmitProblems([]);
    setExcluded((prev) => (ticked ? prev.filter((id) => id !== ticketID) : [...prev, ticketID]));
  }

  // Ticks or unticks every request of one project in one tap.
  function toggleProject(ids: string[], tick: boolean) {
    setSubmitProblems([]);
    setExcluded((prev) => (tick ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])]));
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    if (!isOnline) {
      return Alert.alert(t("mx.offline_title"), t("al.offline_split"));
    }
    if (!receipt.receiptImageURL) return Alert.alert(t("mx.missing_image_title"), t("mx.missing_image_body"));
    if (!Number.isFinite(receiptTotal)) return Alert.alert(t("al.invalid_total"), t("mx.invalid_amount_body"));

    setSubmitting(true);
    setSubmitProblems([]);
    try {
      const category = (draft.category as "Materials" | "Equipment" | "Other" | null) ?? "Materials";
      setDraftCategory(category);
      const saved = await submitAllocation({
        receiptImageURL: receipt.receiptImageURL,
        vendorName: receipt.vendorName,
        receiptDate: receipt.receiptDate,
        category,
        tin: receipt.tin,
        birPermitNumber: receipt.birPermitNumber,
        birNumber: receipt.birNumber,
        receiptTotal,
        lineItems,
        excludeTicketIDs: [...(outOfScope ?? []), ...excluded],
        feeTargets: {},
        lineTargets,
        commonReceiptID,
        note: needsReason ? reason : undefined,
      });
      setResult(saved);
      // Submitted: take it off the Turn In list so it can't be sent twice.
      if (draft.scanID) dismissScan(draft.scanID).catch(() => {});
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details?.problems)) {
        // The requests changed since the preview (e.g. another receipt filled
        // one). Show why and refresh the preview.
        setSubmitProblems(err.details.problems);
        setRefreshKey((k) => k + 1);
      } else {
        Alert.alert(t("mx.submission_failed"), describeLoadError(err, true) ?? t("al.err_generic"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  /** Clear submission problems and refresh the preview without rescanning the receipt. */
  function retryPreview() {
    setSubmitProblems([]);
    setRefreshKey((k) => k + 1);
  }

  function finish() {
    router.replace("/turn-in");
    reset();
  }

  const helperText = submitting
    ? null
    : loading
      ? t("al.working")
      : !!error || !plan
        ? t("al.split_failed")
        : portions.length === 0 && missing.length === 0
          ? t("ck.nothing_ticked")
          : !plan.ok
            ? t("al.match_every")
            : !reasonOk
              ? t("ck.need_reason")
              : t("al2.goes_to_pm");

  // ---- After a successful submit -----------------------------------------
  if (result) {
    const name = (id: string) => known[id]?.projectName ?? t("split.request");
    const screening = Object.values(result.screening ?? {});
    const flagged = screening.filter((s) => (s.flagTypes ?? []).length > 0).length;
    const notScreened = screening.filter((s) => s.flagTypes === null).length;
    return (
      <SafeAreaView style={styles.safeArea}>
        <FlowHeader title={t("al2.done_title")} hideBack />
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.matched}>
            <IconSymbol name="checkmark.circle.fill" size={22} color={COLORS.success} />
            <Text style={styles.matchedText}>{t("ck.sent")}</Text>
          </View>
          <Text style={styles.body}>{t("al.created", { count: result.expenses.length })}</Text>

          {result.resolvedTicketIDs.length > 0 && <Text style={styles.sectionTitle}>{t("split.completed_requests")}</Text>}
          {result.resolvedTicketIDs.map((id) => (
            <Text key={id} style={[styles.body, { color: COLORS.success }]}>✓ {name(id)}</Text>
          ))}

          {result.stillOpenTicketIDs.length > 0 && <Text style={styles.sectionTitle}>{t("split.still_open")}</Text>}
          {result.stillOpenTicketIDs.map((id) => (
            <Text key={id} style={styles.body}>• {name(id)}</Text>
          ))}

          {flagged > 0 && (
            <View style={[styles.notice, { backgroundColor: AMBER_BG }]}>
              <Text style={[styles.noticeText, { color: AMBER }]}>{t("al.flagged", { count: flagged })}</Text>
            </View>
          )}
          {notScreened > 0 && (
            <View style={[styles.notice, { backgroundColor: RED_BG }]}>
              <Text style={[styles.noticeText, { color: RED }]}>{t("split.not_screened_body", { count: notScreened })}</Text>
            </View>
          )}

          <TouchableOpacity style={styles.submitButton} onPress={finish} accessibilityRole="button">
            <Text style={styles.submitButtonText}>{t("al2.back_turnin")}</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- Check receipt -----------------------------------------------------
  const rows = [
    ...portions.map((p) => ({ id: p.ticketID, ticked: true, portion: p })),
    ...unticked.map((id) => ({ id, ticked: false, portion: undefined })),
  ];
  const feeTarget = lineItems.some((l) => l.quantity === 0) ? portions[0]?.projectName : null;
  const projects = groupByProject(rows, (row) => ({
    id: known[row.id]?.projectID ?? row.id,
    name: known[row.id]?.projectName ?? t("split.request"),
    amount: row.portion ? Number(row.portion.amount) : 0,
    at: undefined,
  }));
  const shownOpen = openProject === undefined ? (projects.length === 1 ? projects[0].projectId : null) : openProject;

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlowHeader title={t("ck.title")} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.summary}>
          <View style={styles.flex}>
            <Text style={styles.summaryVendor} numberOfLines={1}>{receipt.vendorName || t("mobile.receipt")}</Text>
            {receipt.receiptDate ? (
              <Text style={styles.muted}>{formatDate(receipt.receiptDate, { day: "numeric", month: "short", year: "numeric" })}</Text>
            ) : null}
          </View>
          {Number.isFinite(receiptTotal) ? <Text style={styles.summaryTotal}>{formatPeso(receiptTotal)}</Text> : null}
        </View>

        {scope && scope.projectNames.length > 0 ? (
          <Text style={styles.help}>{t("ck.scope_note", { projects: scope.projectNames.join(", ") })}</Text>
        ) : null}

        {loading && <ActivityIndicator color={COLORS.primary} />}
        {!isOnline ? (
          <View style={[styles.notice, { backgroundColor: AMBER_BG }]}>
            <Text style={[styles.noticeText, { color: AMBER }]}>{t("al.offline_banner")}</Text>
          </View>
        ) : error ? (
          <View style={[styles.notice, { backgroundColor: RED_BG }]}>
            <Text style={[styles.noticeText, { color: RED }]}>{describeLoadError(error, true)}</Text>
          </View>
        ) : null}

        {/* The one real decision: which requests did this receipt pay for? */}
        {rows.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{t("ck.for_what")}</Text>
            <Text style={styles.help}>{t("ck.for_what_help")}</Text>
          </>
        )}
        {projects.map((project) => {
          const tickedCount = project.items.filter((row) => row.ticked).length;
          const state = tickState(tickedCount, project.count);
          const itemsLabel = t(project.count === 1 ? "tb.items_one" : "tb.items_other", { count: project.count });
          const subtitle = tickedCount > 0 ? `${itemsLabel} · ${formatPeso(project.total)}` : itemsLabel;
          return (
            <ProjectGroup
              key={project.projectId}
              title={project.projectName}
              subtitle={subtitle}
              state={state}
              open={shownOpen === project.projectId}
              onToggleOpen={() => setOpenProject(shownOpen === project.projectId ? null : project.projectId)}
              onToggleTick={() => toggleProject(project.items.map((row) => row.id), state !== "all")}
            >
              {project.items.map(({ id, ticked, portion }) => (
                <Pressable
                  key={id}
                  onPress={() => toggle(id, !ticked)}
                  style={({ pressed }) => [styles.itemRow, pressed && { opacity: 0.85 }]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: ticked }}
                  accessibilityLabel={known[id]?.materialType}
                >
                  <View style={[styles.boxSmall, ticked && styles.boxOn]}>
                    {ticked ? <IconSymbol name="checkmark.circle.fill" size={18} color="#FFFFFF" /> : null}
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.itemTitle} numberOfLines={2}>{known[id]?.materialType ?? ""}</Text>
                    {portion ? (
                      <StatusChip
                        label={portion.resolvesTicket ? t("al2.completes") : t("al2.still_to_buy", { left: `${formatQty(portion.remainingAfter)} ${portion.materialType}` })}
                        tone={portion.resolvesTicket ? "success" : "neutral"}
                      />
                    ) : null}
                  </View>
                  {portion ? <Text style={styles.itemAmount}>{formatPeso(Number(portion.amount))}</Text> : null}
                </Pressable>
              ))}
            </ProjectGroup>
          );
        })}
        {feeTarget ? <Text style={styles.help}>{t("ck.fees_note", { project: feeTarget })}</Text> : null}

        {/* Nothing matches: the only way forward is a request, so say who can file it. */}
        {!loading && missing.length > 0 && (
          <View style={styles.errorBox} accessibilityRole="alert">
            {missing.map((piece) => (
              <Text key={piece.lineIndex} style={styles.errorBoxText}>
                {t("al2.no_request", { description: piece.description, amount: formatPeso(piece.amount) })}
              </Text>
            ))}
            <Text style={styles.errorBoxText}>{t("al2.no_request_help")}</Text>
            <TouchableOpacity style={styles.checkButton} onPress={retryPreview} accessibilityRole="button">
              <Text style={styles.checkButtonText}>{t("al.check_new")}</Text>
            </TouchableOpacity>
          </View>
        )}

        {submitProblems.length > 0 && (
          <View style={styles.errorBox} accessibilityRole="alert">
            {submitProblems.map((problem, index) => (
              <Text key={`problem-${index}`} style={styles.errorBoxText}>{problem}</Text>
            ))}
          </View>
        )}

        {/* Only when something is out of the ordinary: say what, then ask for a few words. */}
        {needsReason && !loading && (
          <View style={[styles.notice, styles.reasonBox]}>
            {extras.map((p) => (
              <Text key={`extra-${p.ticketID}`} style={[styles.noticeText, { color: AMBER }]}>
                {t("ck.extra", { qty: formatQty(p.extraQuantity), material: p.materialType, project: p.projectName })}
              </Text>
            ))}
            {overspent.map((p) => (
              <Text key={`over-${p.ticketID}`} style={[styles.noticeText, { color: AMBER }]}>
                {t("ck.over_budget", { over: formatPeso(Number(p.amount) - Number(p.remainingBudget ?? 0)), project: p.projectName })}
              </Text>
            ))}
            <Text style={styles.reasonTitle}>{t("ck.reason_title")}</Text>
            <View style={styles.chipRow}>
              {REASONS.map((r) => (
                <TouchableOpacity
                  key={r.key}
                  style={[styles.chip, reasonKey === r.key && styles.chipActive]}
                  onPress={() => setReasonKey(reasonKey === r.key ? null : r.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: reasonKey === r.key }}
                >
                  <Text style={[styles.chipText, reasonKey === r.key && { color: COLORS.primary }]}>{t(r.labelKey)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.input}
              value={details}
              onChangeText={setDetails}
              placeholder={t("ck.reason_hint")}
              placeholderTextColor={COLORS.muted}
              maxLength={200}
              multiline
            />
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.submitButton, !canSubmit && { opacity: 0.5 }]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit }}
        >
          <Text style={styles.submitButtonText}>
            {submitting ? t("common.submitting") : Number.isFinite(receiptTotal) ? t("al2.submit", { amount: formatPeso(receiptTotal) }) : t("split.submit_for_approval")}
          </Text>
        </TouchableOpacity>
        {helperText ? <Text style={styles.helper}>{helperText}</Text> : null}
      </View>
      <LoadingOverlay visible={submitting} message={t("split.submitting")} detail={t("split.creating")} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  container: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },

  summary: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 12 },
  summaryVendor: { fontSize: 16, fontFamily: FONT.extrabold, color: COLORS.heading },
  summaryTotal: { fontSize: 20, fontFamily: FONT.extrabold, color: COLORS.primary },

  itemRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: MIN_TAP, paddingVertical: 8 },
  boxSmall: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: COLORS.inputBorder, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.card },
  itemTitle: { fontSize: 14, fontFamily: FONT.semibold, color: COLORS.heading },
  itemAmount: { fontSize: 13, fontFamily: FONT.bold, color: COLORS.muted },

  sectionTitle: { fontSize: 15, fontFamily: FONT.extrabold, color: COLORS.heading, marginTop: 8 },
  help: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.muted, lineHeight: 19 },
  body: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.heading },
  muted: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted },

  checkRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: MIN_TAP, backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 14 },
  checkRowOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryTint },
  box: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: COLORS.inputBorder, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.card },
  boxOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primary },
  cardTitle: { fontSize: 16, fontFamily: FONT.bold, color: COLORS.heading },
  cardLine: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.muted, marginBottom: 4 },

  matched: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: COLORS.successBg, borderRadius: 12, padding: 12 },
  matchedText: { flex: 1, fontSize: 14, fontFamily: FONT.bold, color: COLORS.success },

  errorBox: { backgroundColor: COLORS.errorFill, borderWidth: 1, borderColor: COLORS.errorBorder, borderRadius: 14, padding: 12, gap: 8 },
  errorBoxText: { fontSize: 13, fontFamily: FONT.medium, color: COLORS.errorText, lineHeight: 19 },
  checkButton: { minHeight: MIN_TAP, justifyContent: "center", alignItems: "center", borderWidth: 1.5, borderColor: COLORS.errorBorder, borderRadius: 12, backgroundColor: COLORS.card },
  checkButtonText: { fontSize: 14, fontFamily: FONT.bold, color: COLORS.errorText },
  notice: { borderRadius: 10, padding: 10 },
  noticeText: { fontSize: 13, fontFamily: FONT.medium, lineHeight: 19 },
  reasonBox: { backgroundColor: AMBER_BG, gap: 8, padding: 14, borderRadius: 14 },
  reasonTitle: { fontSize: 13, fontFamily: FONT.bold, color: COLORS.heading, marginTop: 4 },
  input: { minHeight: 56, borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 12, backgroundColor: COLORS.card, padding: 10, fontSize: 14, fontFamily: FONT.regular, color: COLORS.heading, textAlignVertical: "top" },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 22, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: COLORS.card },
  chipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryTint },
  chipText: { fontSize: 13, fontFamily: FONT.semibold, color: COLORS.heading },

  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, gap: 6, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.card },
  helper: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, textAlign: "center" },
  submitButton: { minHeight: 52, backgroundColor: COLORS.primary, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  submitButtonText: { color: "#FFF", fontFamily: FONT.bold, fontSize: 16 },
});
