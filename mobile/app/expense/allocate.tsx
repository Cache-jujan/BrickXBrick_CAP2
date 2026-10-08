// allocate.tsx — F8 step 3 of 3. The server decides the split; this screen
// shows the preview, lets the Purchaser exclude a request or move a fee line,
// and submits. Every amount shown here comes from the server.
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";

import { useExpenseDraft } from "@/lib/expense-draft-context";
import {
  ApiError,
  previewAllocation,
  submitAllocation,
  type AllocationPlan,
  type AllocationResult,
  type SplitLine,
} from "@/lib/api";
import { formatPeso, formatQty } from "@/lib/money";
import { COLORS } from "@/constants/expense-flow-colors";
import { FlowHeader } from "@/components/flow-header";
import { LoadingOverlay } from "@/components/loading-overlay";

const CATEGORIES = ["Materials", "Equipment", "Other"] as const;
type Category = (typeof CATEGORIES)[number];
type KnownTicket = { ticketID: string; projectName: string; materialType: string };

const RED = "#C1121F";
const RED_BG = "#FDECEC";
const AMBER = "#B45309";
const AMBER_BG = "#FEF3C7";

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
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details?.problems)) {
        // The requests changed since the preview (e.g. another receipt filled
        // one). Show why and refresh the preview.
        setSubmitProblems(err.details.problems);
        setRefreshKey((k) => k + 1);
      } else {
        Alert.alert("Submission failed", err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function finish() {
    router.replace("/");
    reset();
  }

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
              <Text style={{ color: AMBER, fontSize: 12 }}>{flagged} portion(s) were flagged for PM review.</Text>
            </View>
          )}
          {notScreened > 0 && (
            <View style={[styles.notice, { backgroundColor: RED_BG }]}>
              <Text style={{ color: RED, fontSize: 12 }}>Screening didn't run for {notScreened} portion(s). Tell the PM.</Text>
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
      <FlowHeader title="Allocate to requests" caption="Split receipt · Step 3 of 3" />
      <ScrollView contentContainerStyle={styles.container}>

        {loading && <ActivityIndicator color={COLORS.primary} style={{ marginBottom: 12 }} />}
        {error && (
          <View style={[styles.notice, { backgroundColor: RED_BG }]}>
            <Text style={{ color: RED, fontSize: 12 }}>{error}</Text>
          </View>
        )}

        {/* E3: anything no open request covers blocks the submit. */}
        {[...submitProblems, ...(plan && !plan.ok ? plan.problems : [])].map((problem, index) => (
          <View key={`problem-${index}`} style={[styles.notice, { backgroundColor: RED_BG }]}>
            <Text style={{ color: RED, fontSize: 12 }}>{problem}</Text>
          </View>
        ))}

                {plan && !plan.ok && excluded.length > 0 && (
          <View style={[styles.notice, { backgroundColor: AMBER_BG }]}>
            <Text style={{ color: AMBER, fontSize: 12 }}>
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
            <View key={`line-${lineIndex}`} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.lineTitle} numberOfLines={2}>{line.description}</Text>
                <Text style={styles.lineAmount}>{formatPeso(line.amount)}</Text>
              </View>
              <Text style={styles.muted}>{isFee ? "Fee / VAT / delivery (qty 0)" : `Qty ${formatQty(line.quantity)}`}</Text>

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
                  {piece.quantity > 0 ? `Not covered: ${formatQty(piece.quantity)} · ${formatPeso(piece.amount)}` : `No request to ride on · ${formatPeso(piece.amount)}`}
                </Text>
              ))}

              {isFee && (plan?.portions.length ?? 0) > 1 && (
                <TouchableOpacity onPress={() => setMovingLine(movingLine === lineIndex ? null : lineIndex)}>
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
        {requestIDs.length === 0 && !loading && <Text style={styles.muted}>No open request matches these lines.</Text>}
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
                  <Text style={{ color: AMBER, fontSize: 12 }}>
                    Over budget: {formatPeso(portion.amount)} vs {formatPeso(portion.remainingBudget)} left
                  </Text>
                </View>
              )}
              <View style={[styles.rowBetween, { marginTop: 8 }]}>
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
              style={[styles.chip, category === c && styles.chipActive]}
              onPress={() => { setCategory(c); setDraftCategory(c); }}
            >
              <Text style={[styles.chipText, category === c && { color: COLORS.primary }]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {plan && (
          <View style={styles.rowBetween}>
            <Text style={styles.muted}>Allocated</Text>
            <Text style={styles.total}>{formatPeso(plan.allocated)} of {formatPeso(plan.linesTotal)}</Text>
          </View>
        )}

        <TouchableOpacity style={[styles.submitButton, !canSubmit && { opacity: 0.5 }]} onPress={handleSubmit} disabled={!canSubmit}>
          <Text style={styles.submitButtonText}>
            {submitting ? "Submitting…" : !category && plan?.ok ? "Pick a category" : "Submit Split for Approval"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
      <LoadingOverlay visible={submitting} message="Submitting split…" detail="Creating one expense per request." />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  container: { paddingHorizontal: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: COLORS.heading, marginTop: 12, marginBottom: 8 },
  body: { fontSize: 13, color: COLORS.heading, marginBottom: 4 },
  muted: { fontSize: 12, color: COLORS.muted },
  card: { backgroundColor: COLORS.card, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 12, marginBottom: 8 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  lineTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: COLORS.heading },
  lineAmount: { fontSize: 14, fontWeight: "700", color: COLORS.heading },
  piece: { fontSize: 12, color: COLORS.heading, marginTop: 6 },
  link: { fontSize: 12, fontWeight: "700", color: COLORS.primary, marginTop: 8 },
  notice: { borderRadius: 10, padding: 10, marginBottom: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: COLORS.card },
  chipActive: { borderColor: COLORS.primary, backgroundColor: "#FDECE1" },
  chipText: { fontSize: 12, fontWeight: "600", color: COLORS.heading },
  total: { fontSize: 16, fontWeight: "800", color: COLORS.heading },
  submitButton: { marginTop: 14, backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  submitButtonText: { color: "#FFF", fontWeight: "700", fontSize: 15 },
});
