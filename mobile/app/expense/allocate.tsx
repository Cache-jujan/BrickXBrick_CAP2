// allocate.tsx: "Check receipt": the last step for a receipt that is not tied to one request.
//
// The Purchaser's job here is small: confirm which requests the receipt paid for (the app
// has already ticked the ones that match) and, only when they spent past what the PM gave or
// bought more than was requested, say why in a few words. The split maths stays on the
// server; the Project Manager sees the reason and decides.
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
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
  type BudgetIssue,
  type PlanCandidate,
  type PlanPortion,
  type SplitLine,
} from "@/lib/api";
import { formatPeso, formatPesoCents, formatQty, toCents } from "@/lib/money";
import { COLORS, FONT, MIN_TAP } from "@/constants/expense-flow-colors";
import { AppButton } from "@/components/app-button";
import { BudgetAdjustmentSheet } from "@/components/budget-adjustment-sheet";
import { FlowHeader } from "@/components/flow-header";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { LoadingOverlay } from "@/components/loading-overlay";
import { ProjectGroup } from "@/components/project-group";
import { ProjectPill } from "@/components/project-pill";
import { StatusChip } from "@/components/status-chip";
import { groupByProject, outOfScopeTicketIDs } from "@/lib/project-groups";
import { loadOpenRequests } from "@/lib/cached-api";
import { describeLoadError } from "@/lib/sync/messages";
import { useNetwork } from "@/lib/sync/network-context";
import { useLocale } from "@/lib/i18n-context";

// Everything seen about a request, kept even while it is unticked so its row can still say what it asked for.
type KnownTicket = {
  ticketID: string;
  projectID: string;
  projectName: string;
  materialType: string;
  /** Receipt lines this request matched (a request unticked later keeps its place under the material). */
  lineIndexes: number[];
  requestedQuantity: number | null;
  /** Still to buy on the request: the most that can be typed for it. */
  remainingQuantity: number | null;
  unit: string | null;
  remainingBudget: string | null;
};
// The note is read by the Project Manager, so it is always saved in English.
// Quick reasons are for finishing a request UNDER budget only.
const REASONS = [
  { key: "cheaper", labelKey: "ck.under_cheaper", text: "Prices were lower than expected." },
  { key: "stock", labelKey: "ck.under_stock", text: "The store ran out of stock." },
  { key: "less", labelKey: "ck.under_less", text: "Needed less than planned." },
  { key: "alt", labelKey: "ck.under_alt", text: "Bought a cheaper alternative." },
] as const;

const RED = COLORS.errorText;
const RED_BG = COLORS.errorFill;
const AMBER = COLORS.amberText;
const AMBER_BG = COLORS.amberBannerFill;

type TotalsProps = {
  state: "complete" | "blocked" | "incomplete";
  receiptTotal: string;
  allocated: string;
  remaining: string;
  ratio: string | null;
  /** Extra rows under the money rows, e.g. the quantity allocated for each material. */
  extra?: React.ReactNode;
};

// Receipt total / allocated / remaining. Every figure arrives already worked out by the server preview.
// Green only when the receipt is fully allocated AND nothing blocks sending it.
function AllocationTotals({ state, receiptTotal, allocated, remaining, ratio, extra }: TotalsProps) {
  const { t } = useLocale();
  return (
    <View style={styles.allocationTotals}>
      {state === "complete" ? (
        <View style={styles.completionBanner} accessibilityRole="text">
          <IconSymbol name="checkmark.circle.fill" size={21} color={COLORS.success} />
          <Text style={styles.completionTitle}>{t("ck.fully_allocated")}</Text>
        </View>
      ) : state === "blocked" ? (
        <View style={styles.blockedBanner} accessibilityRole="alert">
          <Text style={styles.blockedTitle}>{t("ck.allocated_blocked")}</Text>
        </View>
      ) : null}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>{t("ck.receipt_total_label")}</Text>
        <Text style={styles.totalValue}>{receiptTotal}</Text>
      </View>
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>{t("ck.allocated_label")}</Text>
        <Text style={styles.totalValue}>{allocated}</Text>
      </View>
      <View style={[styles.totalRow, styles.remainingRow]}>
        <Text style={[styles.totalLabel, state === "incomplete" && styles.remainingText]}>{t("ck.remaining_label")}</Text>
        <Text style={[styles.totalValue, state === "incomplete" && styles.remainingText]}>{remaining}</Text>
      </View>
      {ratio ? <Text style={state === "complete" ? styles.completionAmount : styles.ratioMuted}>{ratio}</Text> : null}
      {extra}
    </View>
  );
}

export default function AllocateScreen() {
  const { t, formatDate } = useLocale();
  const { draft, setCategory: setDraftCategory, reset } = useExpenseDraft();
  const { ocrResult, scope } = draft;

  // Every open request that matches the receipt, listed under its material. Learned from the first preview.
  const [candidates, setCandidates] = useState<PlanCandidate[] | null>(null);
  // How much of each receipt line the Purchaser typed for each request: "lineIndex:ticketID" -> text.
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  // The same amounts, a moment after the last keystroke, so a preview does not run on every digit.
  const [sentAmounts, setSentAmounts] = useState<Record<string, string>>({});
  useEffect(() => {
    const id = setTimeout(() => setSentAmounts(amounts), 350);
    return () => clearTimeout(id);
  }, [amounts]);
  // Scanned for certain projects: the other projects' requests are left out of the match.
  // null until the open requests are known, so the first preview already respects the scope.
  const [outOfScope, setOutOfScope] = useState<string[] | null>(scope ? null : []);
  // Which project rows are open ("lineIndex:projectId"). null = automatic: a lone project opens itself, several start closed.
  const [openIds, setOpenIds] = useState<string[] | null>(null);
  // Which material sections are open (receipt line numbers). null = automatic: a lone material, or one that needs attention.
  const [openSections, setOpenSections] = useState<number[] | null>(null);
  // "Request budget adjustment": the request being asked about, and the requests already asked about.
  const [adjusting, setAdjusting] = useState<{ ticketID: string; material: string; project: string; over: string } | null>(null);
  const [adjustmentSent, setAdjustmentSent] = useState<string[]>([]);
  const [plan, setPlan] = useState<AllocationPlan | null>(null);
  const [known, setKnown] = useState<Record<string, KnownTicket>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // True while a pull-down reload is running, so the pull spinner shows instead of the inline one.
  const [pulling, setPulling] = useState(false);
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

  // The typed amounts as the server wants them: every listed request gets an entry (0 until something is typed),
  // so nothing is allocated that the Purchaser did not type. null until the requests are known.
  const amountKey = (c: { ticketID: string; lineIndexes: number[] }) => `${c.lineIndexes[0]}:${c.ticketID}`;
  const quantityTargets = useMemo(() => {
    if (!candidates) return undefined;
    return Object.fromEntries(
      candidates.map((c) => {
        const value = Number((sentAmounts[amountKey(c)] ?? "").replace(",", "."));
        return [amountKey(c), Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0];
      })
    ) as Record<string, number>;
  }, [candidates, sentAmounts]);

  // Re-run the preview whenever the Purchaser types an amount.
  useEffect(() => {
    if (!ocrResult || result || outOfScope === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    previewAllocation(lineItems, { excludeTicketIDs: outOfScope, feeTargets: {}, lineTargets, quantityTargets })
      .then((next) => {
        if (cancelled) return;
        setPlan(next);
        // Every request that matches the receipt is listed under its material, whether or not anything is
        // typed for it. Remember them so a request stays on screen.
        const listed = (next.candidates ?? []).filter((c) => !(outOfScope ?? []).includes(c.ticketID));
        if (candidates === null && next.candidates) setCandidates(listed);
        setKnown((prev) => {
          const merged = { ...prev };
          for (const c of listed) {
            merged[c.ticketID] = {
              ticketID: c.ticketID,
              projectID: c.projectID,
              projectName: c.projectName,
              materialType: c.materialType,
              lineIndexes: c.lineIndexes,
              requestedQuantity: c.requestedQuantity,
              remainingQuantity: c.remainingQuantity,
              unit: c.unit,
              remainingBudget: c.remainingBudget,
            };
          }
          for (const p of next.portions) {
            const lineIndexes = [...new Set([...(merged[p.ticketID]?.lineIndexes ?? []), ...p.lines.map((l) => l.lineIndex)])].sort((a, b) => a - b);
            merged[p.ticketID] = {
              ticketID: p.ticketID,
              projectID: p.projectID,
              projectName: p.projectName,
              materialType: p.materialType,
              lineIndexes,
              requestedQuantity: p.requestedQuantity,
              remainingQuantity: merged[p.ticketID]?.remainingQuantity ?? p.remainingBefore,
              unit: p.unit,
              remainingBudget: p.remainingBudget,
            };
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
        if (!cancelled) {
          setLoading(false);
          setPulling(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `candidates` is only read once, to fill it in
  }, [lineItems, outOfScope, lineTargets, quantityTargets, refreshKey, ocrResult, result]);

  // All hooks are above this line.
  if (!ocrResult || draft.mode !== "split") return <Redirect href="/" />;

  const receipt = ocrResult;
  const portions = plan?.portions ?? [];
  const receiptTotal = Number(receipt.amount);

  // Strict budget: over budget (or no approved budget) cannot be submitted; finishing a request
  // under budget needs a few words. Quantity no request covers never reaches here: it blocks the plan.
  const budgetIssues = plan?.budgetIssues ?? [];
  const blockers = budgetIssues.filter((i) => i.code !== "UNDERSPEND_NOTE_REQUIRED");
  const underspent = budgetIssues.filter((i) => i.code === "UNDERSPEND_NOTE_REQUIRED");
  const needsReason = underspent.length > 0;
  const reason = [REASONS.find((r) => r.key === reasonKey)?.text, details.trim()].filter(Boolean).join(" ");
  const reasonOk = !needsReason || reason.length > 0;

  const missing = [...(plan?.unmatched ?? [])];
  const receiptTotalCents = toCents(String(receiptTotal));
  const allocatedCents = plan ? toCents(plan.allocated) : null;
  const linesTotalCents = plan ? toCents(plan.linesTotal) : null;
  const remainingCents = receiptTotalCents !== null && allocatedCents !== null
    ? receiptTotalCents - allocatedCents
    : null;
  const fullyAllocated = !!plan?.ok
    && receiptTotalCents !== null
    && allocatedCents === receiptTotalCents
    && linesTotalCents === receiptTotalCents;
  const canSubmit = !!plan?.ok && blockers.length === 0 && reasonOk && !loading && !submitting;

  // Typing keeps digits and one decimal point (two decimals at most), the same shape the server accepts.
  function setAmount(key: string, text: string) {
    setSubmitProblems([]);
    const clean = text.replace(",", ".").replace(/[^0-9.]/g, "");
    const [whole = "", ...rest] = clean.split(".");
    setAmounts((prev) => ({ ...prev, [key]: rest.length > 0 ? `${whole}.${rest.join("").slice(0, 2)}` : whole }));
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
        excludeTicketIDs: outOfScope ?? [],
        feeTargets: {},
        lineTargets,
        quantityTargets,
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

  // Leave without submitting: the receipt stays in the scanned list, ready to check once the request exists.
  function backToBuy() {
    router.replace("/");
    reset();
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
        : portions.length === 0 && (missing.length === 0 || (candidates?.length ?? 0) > 0)
          ? t("ck.nothing_ticked")
          : !plan.ok
            ? t("ck.helper_unallocated")
            : blockers.length > 0
              ? t("ck.helper_blocked")
              : !reasonOk
              ? t("ck.need_reason")
              : t("al2.goes_to_pm");

  // After a successful submit
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

  // Check receipt: one section per material on the receipt, each listing the requests that asked for it.
  // The Purchaser types how much of the material goes to each request; the server works out the money
  // and checks each request's budget.
  const rows = (candidates ?? []).map((c) => ({
    id: c.ticketID,
    key: amountKey(c),
    line: c.lineIndexes[0],
    portion: portions.find((p) => p.ticketID === c.ticketID) as PlanPortion | undefined,
  }));
  const feeTarget = lineItems.some((l) => l.quantity === 0) ? portions[0]?.projectName : null;
  const qtyText = (quantity: number, unit?: string | null) => `${formatQty(quantity)}${unit ? ` ${unit}` : ""}`;

  // ---- Budget issues, tied to the request they are about ----
  const issueProjectID = (issue: BudgetIssue) => issue.projectID ?? known[issue.ticketID]?.projectID ?? null;
  const issueMaterial = (issue: BudgetIssue) => issue.materialType ?? known[issue.ticketID]?.materialType ?? t("split.request");
  const issueProjectName = (issue: BudgetIssue) => issue.projectName ?? known[issue.ticketID]?.projectName ?? "";
  const issueOf = (ticketID: string) => blockers.find((issue) => issue.ticketID === ticketID);
  const overrunOf = (ticketID: string) => (plan?.overruns ?? []).find((o) => o.ticketID === ticketID);
  const exceedingProjects = new Set(blockers.filter((i) => i.code === "OVER_BUDGET").map((i) => issueProjectID(i) ?? i.ticketID)).size;

  // One section per material line of the receipt (fees have no quantity and ride on a project).
  const sections = lineItems.flatMap((line, index) => {
    if (!(line.quantity > 0)) return [];
    const reqs = rows.filter((row) => row.line === index);
    const projects = groupByProject(reqs, (row) => ({
      id: known[row.id]?.projectID ?? row.id,
      name: known[row.id]?.projectName ?? t("split.request"),
      amount: row.portion ? Number(row.portion.amount) : 0,
      at: undefined,
    }));
    const mine = portions.flatMap((p) => p.lines.filter((l) => l.lineIndex === index));
    const allocatedQty = mine.reduce((sum, l) => sum + l.quantity, 0);
    const leftQty = (plan?.unmatched ?? []).filter((m) => m.lineIndex === index).reduce((sum, m) => sum + m.quantity, 0);
    const unit = reqs.map((row) => known[row.id]?.unit).find(Boolean) ?? null;
    // Nothing on the list asked for this material: only a Site Manager's new request can cover it.
    const noRequest = leftQty > 0 && reqs.length === 0;
    const blocked = reqs.some((row) => (row.portion && issueOf(row.id)) || overrunOf(row.id));
    return [{ index, line, reqs, projects, allocatedQty, leftQty, unit, noRequest, needsAttention: blocked || noRequest }];
  });
  const sectionOpen = (s: (typeof sections)[number]) =>
    (openSections ?? (sections.length === 1 ? [s.index] : sections.filter((x) => x.needsAttention).map((x) => x.index))).includes(s.index);
  const toggleSection = (s: (typeof sections)[number]) => {
    const current = openSections ?? (sections.length === 1 ? [s.index] : sections.filter((x) => x.needsAttention).map((x) => x.index));
    setOpenSections(current.includes(s.index) ? current.filter((i) => i !== s.index) : [...current, s.index]);
  };
  const rowKey = (sectionIndex: number, projectId: string) => `${sectionIndex}:${projectId}`;
  const rowOpen = (sectionIndex: number, projectId: string, lone: boolean) =>
    (openIds ?? (lone ? [rowKey(sectionIndex, projectId)] : [])).includes(rowKey(sectionIndex, projectId));
  const toggleRow = (sectionIndex: number, projectId: string, lone: boolean) => {
    const key = rowKey(sectionIndex, projectId);
    const current = openIds ?? (lone ? [key] : []);
    setOpenIds(current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);
  };
  // The first request that is over its budget, so one tap opens the row that needs fixing.
  const firstBlocked = sections
    .flatMap((s) => s.projects.map((project) => ({ s, project })))
    .find(({ project }) => project.items.some((row) => (row.portion && issueOf(row.id)) || overrunOf(row.id))) ?? null;
  const openBlocked = () => {
    if (!firstBlocked) return;
    const { s, project } = firstBlocked;
    setOpenSections((prev) => {
      const current = prev ?? sections.filter((x) => x.needsAttention).map((x) => x.index);
      return current.includes(s.index) ? current : [...current, s.index];
    });
    setOpenIds((prev) => {
      const key = rowKey(s.index, project.projectId);
      const current = prev ?? [];
      return current.includes(key) ? current : [...current, key];
    });
  };

  // One request inside an opened project: what it asked for, a field for how much of the receipt goes to it,
  // and whether that amount fits its budget.
  const renderRequest = ({ id, key, portion }: (typeof rows)[number]) => {
    const info = known[id];
    const typed = amounts[key] ?? "";
    const issue = portion ? issueOf(id) : undefined;
    const over = overrunOf(id);
    const overBudget = issue?.code === "OVER_BUDGET";
    const bad = !!issue;
    const unit = info?.unit ?? null;
    return (
      <View key={id} style={styles.requestBox}>
        <Text style={styles.itemTitle} numberOfLines={2}>{info?.materialType ?? t("split.request")}</Text>
        <Text style={styles.matCaption}>
          {info?.requestedQuantity != null && info.remainingQuantity != null
            ? t("ck.req_line", { requested: qtyText(info.requestedQuantity, unit), left: qtyText(info.remainingQuantity, unit) })
            : info?.remainingQuantity != null ? t("ck.left_to_buy", { left: qtyText(info.remainingQuantity, unit) }) : ""}
          {info?.remainingBudget != null ? ` · ${t("ck.of_available", { amount: formatPeso(info.remainingBudget) })}` : ""}
        </Text>
        <View style={styles.amountRow}>
          <Text style={styles.amountLabel}>{t("ck.allocate_qty")}</Text>
          <TextInput
            style={[styles.amountInput, !!over && styles.amountInputBad]}
            value={typed}
            onChangeText={(text) => setAmount(key, text)}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={COLORS.muted}
            maxLength={9}
            selectTextOnFocus
            accessibilityLabel={`${t("ck.allocate_qty")}: ${info?.projectName ?? ""} ${info?.materialType ?? ""}`}
          />
          {unit ? <Text style={styles.amountUnit}>{unit}</Text> : null}
        </View>
        {over ? (
          <Text style={styles.statusBad}>
            {t(over.kind === "request" ? "ck.over_request" : "ck.over_receipt", { max: qtyText(over.max, unit) })}
          </Text>
        ) : null}
        {portion ? (
          <>
            <View style={styles.totalRow}>
              <Text style={styles.matQty}>{qtyText(portion.quantity, portion.unit)}</Text>
              <Text style={[styles.matQty, bad && { color: RED }]}>{formatPeso(portion.amount)}</Text>
            </View>
            <View style={styles.statusRow}>
              <IconSymbol name={bad ? "exclamationmark.triangle.fill" : "checkmark.circle.fill"} size={16} color={bad ? RED : COLORS.success} />
              <Text style={[styles.statusText, { color: bad ? RED : COLORS.success }]}>
                {issue ? t(issue.code === "OVER_BUDGET" ? "ck.exceeds_budget" : "ck.no_budget_set") : t("ck.within_budget")}
              </Text>
            </View>
            {/* Over the budget: ask the PM to raise it, with a reason. (No budget at all: only the PM can set one.) */}
            {overBudget && issue?.over ? (
              adjustmentSent.includes(id) ? (
                <Text style={styles.adjustWaiting}>{t("ck.adjust_waiting")}</Text>
              ) : (
                <AppButton
                  label={t("ck.ask_adjust")}
                  onPress={() => setAdjusting({ ticketID: id, material: issueMaterial(issue), project: issueProjectName(issue), over: issue.over! })}
                />
              )
            ) : null}
          </>
        ) : null}
      </View>
    );
  };

  // A calm question, shown only once nothing is over the limit: the request is finished with money left
  // over. One reason covers the whole receipt.
  const renderReason = () => {
    if (loading || blockers.length > 0) return null;
    if (underspent.length === 0) return null;
    return (
      <View style={styles.reasonCard}>
        {underspent.map((issue) => (
          <Text key={`under-${issue.ticketID}`} style={styles.reasonLine}>
            {issue.unused
              ? t("ck.issue_unused", { material: issueMaterial(issue), unused: formatPeso(issue.unused) })
              : issue.message}
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
        {!reasonOk ? <Text style={styles.reasonLine}>{t("ck.need_reason")}</Text> : null}
        <AppButton label={t("ck.send_reason")} onPress={handleSubmit} disabled={!canSubmit} loading={submitting} />
      </View>
    );
  };

  // Allocation complete AND nothing blocks the Purchaser from sending it. Green only when both are true.
  const allocationState: "complete" | "blocked" | "incomplete" = !fullyAllocated
    ? "incomplete"
    : blockers.length > 0 ? "blocked" : "complete";

  // A receipt snapped from one project's header on To Buy: that project is already known.
  const lockedProject = scope && scope.projectIds.length === 1 ? scope.projectNames[0] ?? null : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlowHeader
        title={t("ck.projects_title")}
        caption={t("mx.step_n", { current: 3, total: 3 })}
        step={{ current: 3, total: 3 }}
      />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => { setPulling(true); retryPreview(); }} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
      >
        {loading && !pulling && <ActivityIndicator color={COLORS.primary} />}
        {!isOnline ? (
          <View style={[styles.notice, { backgroundColor: AMBER_BG }]}>
            <Text style={[styles.noticeText, { color: AMBER }]}>{t("al.offline_banner")}</Text>
          </View>
        ) : error ? (
          <View style={[styles.notice, { backgroundColor: RED_BG }]}>
            <Text style={[styles.noticeText, { color: RED }]}>{describeLoadError(error, true)}</Text>
          </View>
        ) : null}

        {lockedProject ? <ProjectPill label={t("mx.project_label")} name={lockedProject} /> : null}
        <Text style={styles.help}>{t("ck.select_intro")}</Text>

        {/* Something is over the limit: say which project and open it, so the fix is one tap away. */}
        {firstBlocked && !loading ? (
          <Pressable onPress={openBlocked} style={({ pressed }) => [styles.attentionCard, pressed && styles.pressed]} accessibilityRole="button">
            <Text style={styles.attentionText}>{t("ck.fix_first", { project: firstBlocked.project.projectName })}</Text>
            <IconSymbol name="chevron.down" size={18} color={RED} />
          </Pressable>
        ) : null}

        {sections.map((s) => {
          const open = sectionOpen(s);
          return (
            <View key={s.index} style={styles.materialCard}>
              <Pressable
                onPress={() => toggleSection(s)}
                style={({ pressed }) => [styles.materialHeader, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
              >
                <View style={styles.flex}>
                  <Text style={styles.materialName} numberOfLines={2}>{s.line.description}</Text>
                  <Text style={styles.materialMeta}>{qtyText(s.line.quantity, s.unit)} · {formatPeso(s.line.amount)}</Text>
                </View>
                {s.needsAttention ? <IconSymbol name="exclamationmark.triangle.fill" size={18} color={RED} /> : null}
                <IconSymbol name={open ? "chevron.down" : "chevron.right"} size={18} color={COLORS.muted} />
              </Pressable>
              {open ? (
                <View style={styles.materialBody}>
                  {s.projects.map((project) => {
                    const typedQty = project.items.reduce((sum, row) => sum + (row.portion?.quantity ?? 0), 0);
                    const typedCents = project.items.reduce((sum, row) => sum + (row.portion ? toCents(String(row.portion.amount)) ?? 0 : 0), 0);
                    // Snapped from one project on To Buy: there is no project to pick, just its requests.
                    if (lockedProject) return <View key={project.projectId}>{project.items.map(renderRequest)}</View>;
                    return (
                      <ProjectGroup
                        key={project.projectId}
                        title={project.projectName}
                        subtitle={typedQty > 0 ? `${qtyText(typedQty, s.unit)} · ${formatPesoCents(typedCents)}` : undefined}
                        open={rowOpen(s.index, project.projectId, s.projects.length === 1)}
                        onToggleOpen={() => toggleRow(s.index, project.projectId, s.projects.length === 1)}
                      >
                        {project.items.map(renderRequest)}
                      </ProjectGroup>
                    );
                  })}
                  {s.leftQty > 0 ? (
                    s.noRequest ? (
                      <View style={styles.missingCard} accessibilityRole="alert">
                        <Text style={styles.missingTitle}>{t("ck.no_request_title")}</Text>
                        <Text style={styles.missingItem}>{t("ck.no_request_body", { qty: qtyText(s.leftQty, s.unit), material: s.line.description })}</Text>
                        <Text style={styles.missingNote}>{t("ck.contact_sm")}</Text>
                        <TouchableOpacity style={styles.backButton} onPress={backToBuy} accessibilityRole="button">
                          <Text style={styles.backButtonText}>{t("al3.back_to_buy")}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <Text style={styles.leftText}>{t("ck.left_qty", { qty: qtyText(s.leftQty, s.unit) })}</Text>
                    )
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}

        {feeTarget ? <Text style={styles.help}>{t("ck.fees_note", { project: feeTarget })}</Text> : null}

        {/* Fees (delivery, VAT) with no request to ride on. */}
        {!loading && missing.some((m) => !(m.quantity > 0)) ? (
          <View style={styles.missingCard} accessibilityRole="alert">
            <Text style={styles.missingTitle}>{t("ck.no_request_title")}</Text>
            {missing.filter((m) => !(m.quantity > 0)).map((piece) => (
              <Text key={piece.lineIndex} style={styles.missingItem}>
                {t("al2.no_request", { description: piece.description, amount: formatPeso(piece.amount) })}
              </Text>
            ))}
            <Text style={styles.missingNote}>{t("ck.contact_sm")}</Text>
          </View>
        ) : null}

        <AllocationTotals
          state={allocationState}
          receiptTotal={formatPeso(receiptTotal)}
          allocated={plan ? formatPeso(plan.allocated) : "—"}
          remaining={remainingCents === null ? "—" : formatPesoCents(remainingCents)}
          ratio={fullyAllocated ? `${formatPesoCents(allocatedCents!)} / ${formatPesoCents(receiptTotalCents!)}` : null}
          extra={
            <>
              {sections.map((s) => (
                <View key={`sum-${s.index}`} style={styles.totalRow}>
                  <Text style={[styles.totalLabel, styles.flex]} numberOfLines={1}>{s.line.description}</Text>
                  <Text style={[styles.totalValue, s.leftQty > 0 && { color: RED }]}>
                    {t("ck.alloc_of", { done: formatQty(s.allocatedQty), total: qtyText(s.line.quantity, s.unit) })}
                  </Text>
                </View>
              ))}
              {exceedingProjects > 0 ? (
                <Text style={styles.exceedText}>{t(exceedingProjects === 1 ? "ck.exceeds_count_one" : "ck.exceeds_count_other", { count: exceedingProjects })}</Text>
              ) : null}
            </>
          }
        />

        {submitProblems.length > 0 && (
          <View style={styles.errorBox} accessibilityRole="alert">
            {submitProblems.map((problem, index) => (
              <Text key={`problem-${index}`} style={styles.errorBoxText}>{problem}</Text>
            ))}
          </View>
        )}

        {/* A reason is asked for only when nothing is over the limit. One reason covers the whole receipt. */}
        {renderReason()}
      </ScrollView>

      <View style={styles.footer}>
        {/* The one action on this step. It cannot be pressed until everything is allocated within budget, and it says why. */}
        <TouchableOpacity
          style={[styles.submitButton, !canSubmit && { opacity: 0.5 }]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit }}
        >
          <Text style={styles.submitButtonText}>
            {submitting ? t("common.submitting") : t("ck.allocate_materials")}
          </Text>
        </TouchableOpacity>
        {helperText ? <Text style={styles.helper}>{helperText}</Text> : null}
      </View>
      <BudgetAdjustmentSheet
        visible={!!adjusting}
        target={adjusting}
        onClose={() => setAdjusting(null)}
        onSent={(ticketID) => {
          setAdjustmentSent((prev) => (prev.includes(ticketID) ? prev : [...prev, ticketID]));
          setAdjusting(null);
          Alert.alert(t("ck.adjust_sent_title"), t("ck.adjust_sent_body"));
        }}
      />
      <LoadingOverlay visible={submitting} message={t("split.submitting")} detail={t("split.creating")} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  container: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },

  receiptSummary: { flexDirection: "row", gap: 14, alignItems: "center", backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 14 },
  receiptThumb: { width: 72, height: 92, borderRadius: 10, backgroundColor: COLORS.bg },
  pdfThumb: { alignItems: "center", justifyContent: "center", gap: 4 },
  pdfCaption: { fontSize: 11, fontFamily: FONT.bold, color: COLORS.muted },
  receiptMeta: { flex: 1, gap: 3 },
  multiBadge: { alignSelf: "flex-start", color: COLORS.primaryTintText, backgroundColor: COLORS.primaryTint, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 8, fontSize: 10, fontFamily: FONT.extrabold, letterSpacing: 0.3, overflow: "hidden", marginBottom: 3 },
  receiptTotalLabel: { fontSize: 12, fontFamily: FONT.semibold, color: COLORS.muted, marginTop: 5 },
  projectCard: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 72, backgroundColor: COLORS.card, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 14, paddingVertical: 12 },
  projectTitle: { fontSize: 16, fontFamily: FONT.bold, color: COLORS.heading },
  projectSubtitle: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 3 },
  projectAmount: { fontSize: 16, fontFamily: FONT.extrabold, color: COLORS.heading },
  allocationTotals: { backgroundColor: COLORS.card, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 14, gap: 9, marginTop: 4 },
  completionBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: COLORS.successBg, borderRadius: 10, padding: 10, marginBottom: 2 },
  completionTitle: { flex: 1, fontSize: 13, fontFamily: FONT.extrabold, color: COLORS.success },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  totalLabel: { fontSize: 13, fontFamily: FONT.medium, color: COLORS.muted },
  totalValue: { fontSize: 14, fontFamily: FONT.bold, color: COLORS.heading },
  remainingRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border, paddingTop: 9 },
  remainingText: { color: COLORS.errorText },
  completionAmount: { textAlign: "center", fontSize: 13, fontFamily: FONT.bold, color: COLORS.success, marginTop: 1 },
  detailHeading: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: COLORS.card, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 14 },
  detailTitle: { fontSize: 18, fontFamily: FONT.extrabold, color: COLORS.heading, marginBottom: 3 },
  detailTotal: { fontSize: 18, fontFamily: FONT.extrabold, color: COLORS.primary },
  projectSelectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 },
  selectAllText: { color: COLORS.primary, fontSize: 13, fontFamily: FONT.bold, paddingVertical: 10, paddingHorizontal: 6 },
  requestCard: { paddingVertical: 2 },
  itemDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  forWhat: { fontSize: 13, fontFamily: FONT.bold, color: COLORS.muted, marginTop: 10, marginBottom: 2 },
  requestHeader: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: MIN_TAP + 8, paddingVertical: 8 },
  materialCard: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  materialHeader: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: MIN_TAP + 12, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: COLORS.primaryTint },
  materialName: { fontSize: 16, fontFamily: FONT.extrabold, color: COLORS.heading, textTransform: "uppercase" },
  materialMeta: { fontSize: 13, fontFamily: FONT.semibold, color: COLORS.primaryTintText, marginTop: 2 },
  materialBody: { gap: 8, padding: 10 },
  requestBox: { gap: 6, paddingVertical: 8 },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  amountLabel: { flex: 1, fontSize: 13, fontFamily: FONT.bold, color: COLORS.heading },
  amountInput: { width: 96, minHeight: MIN_TAP, borderWidth: 1.5, borderColor: COLORS.inputBorder, borderRadius: 10, backgroundColor: COLORS.card, paddingHorizontal: 10, fontSize: 16, fontFamily: FONT.bold, color: COLORS.heading, textAlign: "right" },
  amountInputBad: { borderColor: RED, backgroundColor: RED_BG },
  amountUnit: { fontSize: 13, fontFamily: FONT.medium, color: COLORS.muted, minWidth: 28 },
  matQty: { fontSize: 15, fontFamily: FONT.extrabold, color: COLORS.heading },
  matCaption: { flexShrink: 1, fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusText: { fontSize: 13, fontFamily: FONT.bold },
  leftText: { fontSize: 13, fontFamily: FONT.bold, color: RED, paddingHorizontal: 4 },
  exceedText: { fontSize: 13, fontFamily: FONT.bold, color: RED, marginTop: 2 },
  requestState: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted, marginTop: 2 },
  allocatedLine: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border, paddingVertical: 7, paddingLeft: 34 },
  allocatedLineTitle: { fontSize: 14, fontFamily: FONT.semibold, color: COLORS.heading },
  allocatedLineAmount: { fontSize: 13, fontFamily: FONT.bold, color: COLORS.heading },
  pressed: { opacity: 0.82 },
  projectAmountNone: { color: COLORS.muted, fontFamily: FONT.semibold },
  remainingStrip: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4 },
  blockedBanner: { backgroundColor: COLORS.amberBannerFill, borderRadius: 10, padding: 10, marginBottom: 2 },
  blockedTitle: { fontSize: 13, fontFamily: FONT.extrabold, color: COLORS.amberBannerText },
  ratioMuted: { textAlign: "center", fontSize: 13, fontFamily: FONT.bold, color: COLORS.muted, marginTop: 1 },

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
  missingCard: { backgroundColor: AMBER_BG, borderLeftWidth: 5, borderLeftColor: AMBER, borderRadius: 14, padding: 14, gap: 10 },
  missingTitle: { fontSize: 16, fontFamily: FONT.extrabold, color: COLORS.heading },
  missingItem: { fontSize: 14, fontFamily: FONT.medium, color: COLORS.heading, lineHeight: 20 },
  contactBox: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: COLORS.card, borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: 12, padding: 12 },
  contactTitle: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.heading },
  contactBody: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.heading, lineHeight: 19, marginTop: 2 },
  missingNote: { fontSize: 13, fontFamily: FONT.semibold, color: COLORS.muted, lineHeight: 19 },
  backButton: { minHeight: MIN_TAP, justifyContent: "center", alignItems: "center", borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: 12, backgroundColor: COLORS.card },
  backButtonText: { fontSize: 14, fontFamily: FONT.bold, color: COLORS.primary },
  notice: { borderRadius: 10, padding: 10 },
  noticeText: { fontSize: 13, fontFamily: FONT.medium, lineHeight: 19 },
  issueCard: { backgroundColor: RED_BG, borderWidth: 1.5, borderColor: RED, borderRadius: 14, padding: 14, gap: 10 },
  issueTitle: { fontSize: 15, fontFamily: FONT.extrabold, color: RED, lineHeight: 21 },
  issueFigures: { gap: 6, backgroundColor: COLORS.card, borderRadius: 10, padding: 10 },
  adjustWaiting: { fontSize: 13, fontFamily: FONT.bold, color: COLORS.amberBannerText, backgroundColor: COLORS.amberBannerFill, borderRadius: 10, padding: 10 },
  issueHelp: { fontSize: 13, fontFamily: FONT.medium, color: COLORS.heading, lineHeight: 19 },
  issueAction: { minHeight: MIN_TAP, justifyContent: "center", alignItems: "center", borderWidth: 1.5, borderColor: RED, borderRadius: 12, backgroundColor: COLORS.card },
  issueActionText: { fontSize: 14, fontFamily: FONT.bold, color: RED },
  attentionCard: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: MIN_TAP + 8, backgroundColor: RED_BG, borderRadius: 12, borderWidth: 1, borderColor: RED, paddingHorizontal: 14, paddingVertical: 10 },
  attentionText: { flex: 1, fontSize: 13, fontFamily: FONT.bold, color: RED, lineHeight: 19 },
  statusBad: { color: RED, fontFamily: FONT.bold },
  statusNote: { color: AMBER, fontFamily: FONT.bold },
  statusOk: { color: COLORS.success, fontFamily: FONT.semibold },
  reasonCard: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 14, gap: 8 },
  reasonLine: { fontSize: 13, fontFamily: FONT.medium, color: COLORS.heading, lineHeight: 19 },
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
