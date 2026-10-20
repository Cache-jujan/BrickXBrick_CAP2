// allocate.tsx — F8 step 3 of 3. The server decides the split; this screen
// shows the preview, lets the Purchaser exclude a request or move a fee line,
// and submits. Every amount shown here comes from the server.
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";

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
import { fieldErrorStyle } from "@/components/blocked-reasons";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { LoadingOverlay } from "@/components/loading-overlay";
import { describeLoadError } from "@/lib/sync/messages";
import { useNetwork } from "@/lib/sync/network-context";

const CATEGORIES = ["Materials", "Equipment", "Other"] as const;
type Category = (typeof CATEGORIES)[number];
type KnownTicket = { ticketID: string; projectName: string; materialType: string };

const RED = COLORS.errorText;
const RED_BG = COLORS.errorFill;
const AMBER = COLORS.amberText;
const AMBER_BG = COLORS.amberBannerFill;

/** Preview and submit a split receipt with request exclusions, fee moves and retry support. */
export default function AllocateScreen() {
  const { draft, setCategory: setDraftCategory, reset } = useExpenseDraft();
  const { ocrResult } = draft;

  const [category, setCategory] = useState<Category | null>(draft.category);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [feeTargets, setFeeTargets] = useState<Record<string, string>>({});
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
  const [movingLine, setMovingLine] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitProblems, setSubmitProblems] = useState<string[]>([]);
  const [result, setResult] = useState<AllocationResult | null>(null);

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

  // Re-run the preview whenever the Purchaser excludes a request or moves a fee.
  useEffect(() => {
    if (!ocrResult || result) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    previewAllocation(lineItems, { excludeTicketIDs: excluded, feeTargets })
      .then((next) => {
        if (cancelled) return;
        setPlan(next);
        // Remember every request we've seen, so an excluded one stays on screen
        // and can be switched back on.
        setKnown((prev) => {
          const merged = { ...prev };
          for (const p of next.portions) {
            merged[p.ticketID] = { ticketID: p.ticketID, projectName: p.projectName, materialType: p.materialType };
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
  }, [lineItems, excluded, feeTargets, refreshKey, ocrResult, result]);

  // All hooks are above this line.
  if (!ocrResult || draft.mode !== "split") return <Redirect href="/" />;

  const receipt = ocrResult;
  const portionByTicket = new Map((plan?.portions ?? []).map((p) => [p.ticketID, p]));
  const requestIDs = [
    ...(plan?.portions ?? []).map((p) => p.ticketID),
    ...excluded.filter((id) => !portionByTicket.has(id)),
  ];
  const canSubmit = !!plan?.ok && !!category && !loading && !submitting;

  function toggleExcluded(ticketID: string, value: boolean) {
    setSubmitProblems([]);
    setExcluded((prev) => (value ? [...prev, ticketID] : prev.filter((id) => id !== ticketID)));
  }

  function moveFee(lineIndex: number, ticketID: string) {
    setFeeTargets((prev) => ({ ...prev, [String(lineIndex)]: ticketID }));
    setMovingLine(null);
  }

  async function handleSubmit() {
    if (!canSubmit || !category) return;
    if (!isOnline) {
      return Alert.alert("You're offline", "A split receipt needs a connection to save. Reconnect and tap the button again; nothing is lost.");
    }
    if (!receipt.receiptImageURL) return Alert.alert("Missing receipt image", "Please rescan the receipt.");
    const receiptTotal = Number(receipt.amount);
    if (!Number.isFinite(receiptTotal)) return Alert.alert("Invalid total", "Go back and check the receipt total.");

    setSubmitting(true);
    setSubmitProblems([]);
    try {
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
        excludeTicketIDs: excluded,
        feeTargets,
      });
      setResult(saved);
      // Submitted: take it off "Scanned receipts" so it can't be sent twice.
      if (draft.scanID) dismissScan(draft.scanID).catch(() => {});
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details?.problems)) {
        // The requests changed since the preview (e.g. another receipt filled
        // one). Show why and refresh the preview.
        setSubmitProblems(err.details.problems);
        setRefreshKey((k) => k + 1);
      } else {
        Alert.alert("Submission failed", describeLoadError(err, true) ?? "Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Nothing matched an open request (or the preview failed): the Site Manager
  // may have filed one since, so re-run the preview instead of rescanning.
  const needsRetry =
    !!error || (!!plan && (plan.uncovered.length + plan.unmatched.length > 0 || plan.portions.length === 0));

  /** Clear submission problems and refresh the preview without rescanning the receipt. */
  function retryPreview() {
    setSubmitProblems([]);
    setRefreshKey((k) => k + 1);
  }

  function finish() {
    router.replace("/");
    reset();
  }

  // Receipt lines no open request covers, counted once per line.
  const uncoveredLines = new Set([...(plan?.uncovered ?? []), ...(plan?.unmatched ?? [])].map((l) => l.lineIndex));
  const otherProblems = [...submitProblems, ...(plan && !plan.ok && uncoveredLines.size === 0 ? plan.problems : [])];
  // Allocated vs the receipt's lines, for the footer bar.
  const allocatedNumber = Number(plan?.allocated ?? 0);
  const linesTotalNumber = Number(plan?.linesTotal ?? 0);
  const progress = linesTotalNumber > 0 ? Math.min(1, allocatedNumber / linesTotalNumber) : 0;
  // One short line under the button saying what is still blocking it.
  const helperText = submitting
    ? null
    : loading
      ? "Working out how this receipt splits…"
      : !!error || !plan
        ? "The split couldn't be worked out. Tap Check for new requests."
        : !plan.ok
          ? "Match every line to a request to submit."
          : !category
            ? "Pick a category to submit."
            : null;

  // ---- After a successful submit -----------------------------------------
  if (result) {
    const name = (id: string) => known[id]?.projectName ?? "Request";
    const screening = Object.values(result.screening ?? {});
    const flagged = screening.filter((s) => (s.flagTypes ?? []).length > 0).length;
    const notScreened = screening.filter((s) => s.flagTypes === null).length;
    return (
      <SafeAreaView style={styles.safeArea}>
        <FlowHeader title="Submitted for approval" caption="Split receipt" hideBack />
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.body}>{result.expenses.length} expenses were created from one receipt.</Text>

          <Text style={styles.sectionTitle}>Completed requests</Text>
          {result.resolvedTicketIDs.length === 0 && <Text style={styles.muted}>None</Text>}
          {result.resolvedTicketIDs.map((id) => (
            <Text key={id} style={[styles.body, { color: COLORS.success }]}>✓ {name(id)}</Text>
          ))}

          <Text style={styles.sectionTitle}>Still open</Text>
          {result.stillOpenTicketIDs.length === 0 && <Text style={styles.muted}>None</Text>}
          {result.stillOpenTicketIDs.map((id) => (
            <Text key={id} style={styles.body}>• {name(id)}</Text>
          ))}

          {flagged > 0 && (
            <View style={[styles.notice, { backgroundColor: AMBER_BG }]}>
              <Text style={{ color: AMBER, fontSize: 12, fontFamily: FONT.regular }}>{flagged} portion(s) were flagged for PM review.</Text>
            </View>
          )}
          {notScreened > 0 && (
            <View style={[styles.notice, { backgroundColor: RED_BG }]}>
              <Text style={{ color: RED, fontSize: 12, fontFamily: FONT.regular }}>Screening didn't run for {notScreened} portion(s). Tell the PM.</Text>
            </View>
          )}

          <TouchableOpacity style={styles.submitButton} onPress={finish}>
            <Text style={styles.submitButtonText}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- Preview -------------------------------------------------------------
  return (
    <SafeAreaView style={styles.safeArea}>
      <FlowHeader title="Allocate to requests" caption="Split receipt · Step 3 of 3" step={{ current: 3, total: 3 }} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.container}>

        {loading && <ActivityIndicator color={COLORS.primary} style={{ marginBottom: 12 }} />}
        {!isOnline ? (
          <View style={[styles.notice, { backgroundColor: COLORS.amberBannerFill }]}>
            <Text style={{ color: COLORS.amberText, fontSize: 12, fontFamily: FONT.regular }}>
              You're offline. Splitting a receipt needs a connection to check the open requests. This page refreshes
              by itself when you're back online.
            </Text>
          </View>
        ) : error ? (
          <View style={[styles.notice, { backgroundColor: RED_BG }]}>
            <Text style={{ color: RED, fontSize: 12, fontFamily: FONT.regular }}>{describeLoadError(error, true)}</Text>
          </View>
        ) : null}

        {/* E3: anything no open request covers blocks the submit. One box, not one per line. */}
        {uncoveredLines.size > 0 && !loading && (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorBoxText}>
              No open request for these {uncoveredLines.size} {uncoveredLines.size === 1 ? "item" : "items"}. Ask the Site Manager to file one. Then check again.
            </Text>
            <TouchableOpacity style={styles.checkButton} onPress={retryPreview} accessibilityRole="button" accessibilityLabel="Check for new requests">
              <Text style={styles.checkButtonText}>Check for new requests</Text>
            </TouchableOpacity>
          </View>
        )}

        {otherProblems.length > 0 && (
          <View style={styles.errorBox} accessibilityRole="alert">
            {otherProblems.map((problem, index) => (
              <Text key={`problem-${index}`} style={styles.errorBoxText}>{problem}</Text>
            ))}
          </View>
        )}

        {needsRetry && !loading && uncoveredLines.size === 0 && (
          <TouchableOpacity style={styles.retryButton} onPress={retryPreview} accessibilityRole="button" accessibilityLabel="Check for new requests">
            <Text style={styles.retryButtonText}>Check for new requests</Text>
          </TouchableOpacity>
        )}

        {plan && !plan.ok && excluded.length > 0 && (
          <View style={[styles.notice, { backgroundColor: AMBER_BG }]}>
            <Text style={{ color: AMBER, fontSize: 12, fontFamily: FONT.regular }}>
              You switched off {excluded.length} request{excluded.length === 1 ? "" : "s"} below. Turn one back on if it should cover these lines.
            </Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Receipt lines</Text>
        {lineItems.map((line, lineIndex) => {
          const pieces = (plan?.portions ?? []).flatMap((p) =>
            p.lines.filter((l) => l.lineIndex === lineIndex).map((l) => ({ portion: p, line: l }))
          );
          const missing = [...(plan?.uncovered ?? []), ...(plan?.unmatched ?? [])].filter((l) => l.lineIndex === lineIndex);
          const isFee = line.quantity === 0;
          return (
            <View key={`line-${lineIndex}`} style={[styles.card, missing.length > 0 && styles.cardMissing]}>
              <View style={styles.rowBetween}>
                <Text style={styles.lineTitle} numberOfLines={2}>{line.description}</Text>
                <Text style={styles.lineAmount}>{formatPeso(line.amount)}</Text>
              </View>
              <View style={styles.rowBetween}>
                <Text style={styles.muted}>{isFee ? "Fee / VAT / delivery (qty 0)" : `Qty ${formatQty(line.quantity)}`}</Text>
                {missing.length > 0 && <Text style={styles.notCoveredTag}>Not covered</Text>}
              </View>

              {pieces.map(({ portion, line: piece }) => (
                <Text key={`${portion.ticketID}-${lineIndex}`} style={styles.piece}>
                  {isFee
                    ? `Rides on ${portion.projectName} · ${formatPeso(piece.amount)}`
                    : `${portion.projectName} · ${formatQty(piece.quantity)} · ${formatPeso(piece.amount)} · ${
                        portion.resolvesTicket ? "completes request" : `request stays open (${formatQty(portion.remainingAfter)} left)`
                      }`}
                </Text>
              ))}

              {missing.map((piece, index) => (
                <Text key={`missing-${index}`} style={[styles.piece, { color: RED }]}>
                  {piece.quantity > 0 ? `${formatQty(piece.quantity)} · ${formatPeso(piece.amount)} left over` : `No request to ride on · ${formatPeso(piece.amount)}`}
                </Text>
              ))}

              {isFee && (plan?.portions.length ?? 0) > 1 && (
                <TouchableOpacity style={styles.linkButton} onPress={() => setMovingLine(movingLine === lineIndex ? null : lineIndex)}>
                  <Text style={styles.link}>{movingLine === lineIndex ? "Cancel" : "Move"}</Text>
                </TouchableOpacity>
              )}
              {movingLine === lineIndex && (
                <View style={styles.chipRow}>
                  {(plan?.portions ?? []).map((p) => (
                    <TouchableOpacity key={p.ticketID} style={styles.chip} onPress={() => moveFee(lineIndex, p.ticketID)}>
                      <Text style={styles.chipText}>{p.projectName}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          );
        })}

        <Text style={styles.sectionTitle}>Requests on this receipt</Text>
        {requestIDs.length === 0 && !loading && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No open request matches these lines yet.</Text>
          </View>
        )}
        {requestIDs.map((ticketID) => {
          const portion = portionByTicket.get(ticketID);
          const info = known[ticketID];
          const isExcluded = excluded.includes(ticketID);
          return (
            <View key={ticketID} style={[styles.card, isExcluded && { opacity: 0.6 }]}>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineTitle}>{info?.projectName ?? "Request"}</Text>
                  <Text style={styles.muted}>{info?.materialType ?? ""}</Text>
                </View>
                {portion && <Text style={styles.lineAmount}>{formatPeso(portion.amount)}</Text>}
              </View>
              {portion?.overBudget && (
                <View style={[styles.notice, { backgroundColor: AMBER_BG, marginTop: 6, marginBottom: 0 }]}>
                  <Text style={{ color: AMBER, fontSize: 12, fontFamily: FONT.regular }}>
                    Over budget: {formatPeso(portion.amount)} vs {formatPeso(portion.remainingBudget)} left
                  </Text>
                </View>
              )}
              <View style={[styles.rowBetween, styles.switchRow]}>
                <Text style={styles.muted}>Not for this request</Text>
                <Switch value={isExcluded} onValueChange={(value) => toggleExcluded(ticketID, value)} />
              </View>
            </View>
          );
        })}

        <Text style={styles.sectionTitle}>Category</Text>
        <View style={styles.chipRow}>
          {CATEGORIES.map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.chip, !category && fieldErrorStyle, category === c && styles.chipActive]}
              onPress={() => { setCategory(c); setDraftCategory(c); }}
            >
              <Text style={[styles.chipText, category === c && { color: COLORS.primary }]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </View>

      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.rowBetween}>
          <Text style={styles.footerLabel}>Allocated {formatPeso(allocatedNumber)} of {formatPeso(linesTotalNumber)}</Text>
          {plan?.ok && progress >= 1 && <IconSymbol name="checkmark.circle.fill" size={18} color={COLORS.success} />}
        </View>
        <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
          <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
        <TouchableOpacity style={[styles.submitButton, !canSubmit && { opacity: 0.5 }]} onPress={handleSubmit} disabled={!canSubmit} accessibilityRole="button" accessibilityState={{ disabled: !canSubmit }}>
          <Text style={styles.submitButtonText}>{submitting ? "Submitting…" : "Submit split for approval"}</Text>
        </TouchableOpacity>
        {helperText ? <Text style={styles.helper}>{helperText}</Text> : null}
      </View>
      <LoadingOverlay visible={submitting} message="Submitting split…" detail="Creating one expense per request." />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  container: { paddingHorizontal: 16, paddingBottom: 24 },
  retryButton: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: COLORS.primary, borderRadius: 8, paddingVertical: 10, alignItems: "center", marginBottom: 12 },
  retryButtonText: { color: COLORS.primary, fontSize: 13, fontFamily: FONT.bold },
  sectionTitle: { fontSize: 15, fontFamily: FONT.extrabold, color: COLORS.heading, marginTop: 14, marginBottom: 8 },
  body: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.heading, marginBottom: 4 },
  muted: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted },
  card: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 12, marginBottom: 8 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  lineTitle: { flex: 1, fontSize: 14, fontFamily: FONT.bold, color: COLORS.heading },
  lineAmount: { fontSize: 14, fontFamily: FONT.bold, color: COLORS.heading },
  piece: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.heading, marginTop: 6 },
  link: { fontSize: 12, fontFamily: FONT.bold, color: COLORS.primary },
  linkButton: { minHeight: MIN_TAP, justifyContent: "center", alignSelf: "flex-start" },
  switchRow: { minHeight: MIN_TAP, marginTop: 4 },
  cardMissing: { borderColor: COLORS.errorBorder },
  notCoveredTag: { fontSize: 11, fontFamily: FONT.bold, color: COLORS.errorText, backgroundColor: COLORS.errorFill, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8, overflow: "hidden" },
  errorBox: { backgroundColor: COLORS.errorFill, borderWidth: 1, borderColor: COLORS.errorBorder, borderRadius: 14, padding: 12, marginBottom: 10, gap: 10 },
  errorBoxText: { fontSize: 13, fontFamily: FONT.medium, color: COLORS.errorText, lineHeight: 19 },
  checkButton: { minHeight: MIN_TAP, justifyContent: "center", alignItems: "center", borderWidth: 1.5, borderColor: COLORS.errorBorder, borderRadius: 12, backgroundColor: COLORS.card },
  checkButtonText: { fontSize: 14, fontFamily: FONT.bold, color: COLORS.errorText },
  emptyBox: { minHeight: 64, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderStyle: "dashed", borderColor: COLORS.inputBorder, borderRadius: 14, padding: 14 },
  emptyText: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.muted, textAlign: "center" },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, gap: 8, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.card },
  footerLabel: { fontSize: 14, fontFamily: FONT.extrabold, color: COLORS.heading },
  track: { height: 6, borderRadius: 3, backgroundColor: COLORS.border, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3, backgroundColor: COLORS.primary },
  helper: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, textAlign: "center" },
  notice: { borderRadius: 10, padding: 10, marginBottom: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, marginBottom: 8 },
  chip: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: COLORS.inputBorder, borderRadius: 22, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: COLORS.card },
  chipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryTint },
  chipText: { fontSize: 13, fontFamily: FONT.semibold, color: COLORS.heading },
  submitButton: { minHeight: 48, backgroundColor: COLORS.primary, borderRadius: 12, justifyContent: "center", alignItems: "center", marginTop: 4 },
  submitButtonText: { color: "#FFF", fontFamily: FONT.bold, fontSize: 15 },
});
