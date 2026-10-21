import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import type { Href } from "expo-router";

import { COLORS } from "@/constants/expense-flow-colors";
import {
  createTicketsBatch,
  type ApprovedVendor,
  type BomItem,
  type Project,
  type Ticket,
  type TicketInput,
} from "@/lib/api";
import { loadActiveProjects, loadApprovedVendors, loadAssignedTickets, loadBomItems } from "@/lib/cached-api";
import { savedAtLabel } from "@/lib/sync/offline-cache";
import { getSession } from "@/lib/auth";
import { plainError } from "@/lib/sync/messages";
import { BlockedReasons, fieldErrorStyle } from "@/components/blocked-reasons";
import { DateField } from "@/components/date-field";
import { parseNeededBy, toDateText } from "@/lib/needed-by";
import { FlowHeader } from "@/components/flow-header";
import { KeyboardScreen } from "@/components/screen";
import { AppButton } from "@/components/app-button";
import type { Cached } from "@/lib/cached-api";

type TicketType = "Material Request" | "Work Item" | "Report";
const TICKET_TYPES: TicketType[] = ["Material Request", "Work Item", "Report"];

// Sentinel for the BOM-item picker when the material isn't in the BOM.
const NOT_IN_BOM = "__not_in_bom__";

const UNIT_OPTIONS = [
  "pcs", "set", "lot", "unit",
  "kg", "g", "L", "mL",
  "m", "cm", "mm", "sq.m", "cu.m",
  "bag", "box", "roll", "sheet", "pair", "bundle", "gal", "can", "truckload",
];

type Card = {
  id: string;
  ticketType: TicketType;
  bomItemID: string; // "" | NOT_IN_BOM | a real bomItemId
  materialType: string; // not-in-BOM Material Request, or Work Item
  notInBomReason: string;
  quantity: string;
  unit: string; // chosen unit (not-in-BOM / Work Item)
  vendorName: string; // optional
  requestedBudget: string;
  neededBy: string; // optional "YYYY-MM-DD"
  reportText: string; // Report
};

function emptyCard(id: string): Card {
  return {
    id,
    ticketType: "Material Request",
    bomItemID: "",
    materialType: "",
    notInBomReason: "",
    quantity: "",
    unit: "",
    vendorName: "",
    requestedBudget: "",
    neededBy: "",
    reportText: "",
  };
}

// A past date would be refused by the server, so a resubmit drops it.
function keepFutureDate(value?: string | null) {
  const date = parseNeededBy(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date && date >= today ? toDateText(date) : "";
}

// Build a card prefilled from a rejected ticket, so the SM lands with every
// field already filled from the original and only has to fix what the PM
// flagged. BOM linkage is preserved; "not in BOM" too.
function prefilledCard(id: string, t: Ticket): Card {
  const tt = (t.tickettype as Card["ticketType"]) || "Material Request";
  const isReport = tt === "Report";
  const notInBom = t.notinbom === true;
  return {
    id,
    ticketType: tt,
    bomItemID: isReport ? "" : (t.bomitemid ? String(t.bomitemid) : (notInBom ? NOT_IN_BOM : "")),
    materialType: t.materialtype || "",
    notInBomReason: t.notinbomreason || "",
    quantity: t.quantity == null ? "" : String(t.quantity),
    unit: t.unit || "",
    vendorName: t.vendorname || "",
    requestedBudget: t.requestedbudget == null ? "" : String(t.requestedbudget),
    neededBy: keepFutureDate(t.neededby),
    reportText: isReport ? (t.description || t.subject || "") : "",
  };
}

export default function TicketRequestScreen() {
  const session = getSession();
  // Optional query param: when present, this screen is in "fix & resubmit"
  // mode — one card prefilled from the rejected ticket, project locked,
  // "+ Add another" hidden, and the ticket id sent back as resubmittedFromId.
  const { resubmitFrom } = useLocalSearchParams<{ resubmitFrom?: string }>();
  const resubmitId = typeof resubmitFrom === "string" ? resubmitFrom : null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [vendors, setVendors] = useState<ApprovedVendor[]>([]);
  // The rejected ticket we're resubmitting (null in the ordinary flow).
  const [resubmitOf, setResubmitOf] = useState<Ticket | null>(null);

  // step: which stage of the gate we're in.
  const [project, setProject] = useState<Project | null>(null);
  const [bomItems, setBomItems] = useState<BomItem[]>([]);
  const [bomLoading, setBomLoading] = useState(false);

  const [cards, setCards] = useState<Card[]>([emptyCard("c1")]);
  const cardSeq = useRef(1);
  const [openKey, setOpenKey] = useState<string | null>(null); // "<cardId>:<field>"
  const [submitting, setSubmitting] = useState(false);
  // Set once the tickets were sent: shows the confirmation screen instead of the form.
  // Set when a list on this form is the copy saved on this phone (offline).
  const [savedAt, setSavedAt] = useState<string | null>(null);
  function noteSaved(...results: Cached<unknown>[]) {
    const old = results.find((r) => r.fromCache);
    if (old) setSavedAt((prev) => prev ?? old.savedAt);
  }
  const [sent, setSent] = useState<{ count: number; resubmit: boolean } | null>(null);

  useEffect(() => {
    if (!session || session.user.role !== "Site Manager") return;
    // Every list comes from the server when it can be reached, otherwise from
    // the copy saved on this phone, so the form still opens offline.
    const loads: Promise<unknown>[] = [loadActiveProjects(), loadApprovedVendors()];
    if (resubmitId) loads.push(loadAssignedTickets("Site Manager"));
    Promise.all(loads)
      .then((results) => {
        const projectResult = results[0] as Cached<Project[]>;
        const vendorResult = results[1] as Cached<ApprovedVendor[]>;
        const projectList = projectResult.data;
        const vendorList = vendorResult.data;
        setProjects(projectList);
        setVendors(vendorList);
        noteSaved(projectResult, vendorResult);
        if (resubmitId) {
          const orig = (results[2] as Cached<Ticket[]>).data.find((t) => t.ticketid === resubmitId);
          if (!orig) {
            setError("The request you're resubmitting is no longer available.");
            return;
          }
          if (orig.status !== "Rejected") {
            setError("This request has already been handled — only rejected requests can be resubmitted.");
            return;
          }
          setResubmitOf(orig);
          const origProject = projectList.find((p) => p.projectid === orig.projectid);
          if (origProject) setProject(origProject);
          // Prefill one card from the rejected original.
          setCards([prefilledCard("c1", orig)]);
        } else if (projectList.length === 1) {
          // Auto-route: exactly one project → skip the chooser.
          setProject(projectList[0]);
        }
      })
      .catch((err) => setError(plainError(err, "Unable to load request options.")))
      .finally(() => setLoading(false));
  }, [session?.user.role, resubmitId]);

  // Load the approved BOM items once a project is chosen (for the item picker).
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    setBomLoading(true);
    loadBomItems(project.projectid)
      .then((result) => {
        if (cancelled) return;
        setBomItems(result.data);
        noteSaved(result);
      })
      .catch(() => { if (!cancelled) setBomItems([]); })
      .finally(() => { if (!cancelled) setBomLoading(false); });
    return () => { cancelled = true; };
  }, [project?.projectid]);

  if (!session || session.user.role !== "Site Manager") return <Redirect href="/login" />;

  function updateCard(id: string, patch: Partial<Card>) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setError(null);
  }
  function addCard() {
    cardSeq.current += 1;
    setCards((prev) => [...prev, emptyCard(`c${cardSeq.current}`)]);
  }
  function removeCard(id: string) {
    setCards((prev) => (prev.length === 1 ? prev : prev.filter((c) => c.id !== id)));
  }

  function bomUnitFor(card: Card): string | null {
    if (card.ticketType !== "Material Request" || !card.bomItemID || card.bomItemID === NOT_IN_BOM) return null;
    return bomItems.find((it) => it.bomItemId === card.bomItemID)?.unit ?? null;
  }

  // Returns an error string for a card, or null if it's valid.
  function validateCard(card: Card): string | null {
    const qty = Number(card.quantity);
    if (card.ticketType === "Report") {
      if (!card.reportText.trim()) return "Describe the issue.";
      return null;
    }
    // Material Request / Work Item share quantity.
    if (!card.quantity || !Number.isFinite(qty) || qty <= 0) return "Enter a quantity greater than 0.";

    if (card.ticketType === "Work Item") {
      if (!card.materialType.trim()) return "Enter what's needed.";
      if (!card.unit.trim()) return "Choose a unit.";
      return null;
    }
    // Material Request
    if (!card.bomItemID) return "Pick a BOM item, or “Not in the BOM”.";
    if (card.bomItemID === NOT_IN_BOM) {
      if (!card.materialType.trim()) return "Enter the material.";
      if (!card.unit.trim()) return "Choose a unit.";
      if (!card.notInBomReason.trim()) return "Say why it isn't in the BOM.";
    }
    if (card.requestedBudget === "" || !Number.isFinite(Number(card.requestedBudget)) || Number(card.requestedBudget) < 0) {
      return "Enter a requested budget of 0 or more.";
    }
    return null;
  }

  function cap100(text: string) {
    const t = text.trim();
    return t.length > 100 ? t.slice(0, 100) : t;
  }

  function buildPayload(card: Card): TicketInput {
    const vendorName = card.vendorName.trim() || undefined;
    const neededBy = card.neededBy || undefined;
    if (card.ticketType === "Report") {
      return {
        projectID: project!.projectid,
        ticketType: "Report",
        subject: cap100(card.reportText),
        description: card.reportText.trim(),
      };
    }
    if (card.ticketType === "Work Item") {
      return {
        projectID: project!.projectid,
        ticketType: "Work Item",
        subject: cap100(card.materialType),
        materialType: card.materialType.trim(),
        quantity: Number(card.quantity),
        unit: card.unit,
        vendorName,
        neededBy,
      };
    }
    // Material Request
    const notInBom = card.bomItemID === NOT_IN_BOM;
    const bomDesc = notInBom
      ? card.materialType
      : bomItems.find((it) => it.bomItemId === card.bomItemID)?.description || "Material request";
    const base: TicketInput = {
      projectID: project!.projectid,
      ticketType: "Material Request",
      subject: cap100(bomDesc),
      quantity: Number(card.quantity),
      vendorName,
      neededBy,
      requestedBudget: Number(card.requestedBudget),
    };
    if (notInBom) {
      base.notInBom = true;
      base.notInBomReason = card.notInBomReason.trim();
      base.materialType = card.materialType.trim();
      base.unit = card.unit; // creator-supplied for not-in-BOM
    } else {
      base.bomItemID = card.bomItemID; // materialType + unit derived server-side
    }
    return base;
  }

  // In resubmit mode, tag the first card with the original ticket's id so the
  // backend links the two (and the PM sees the resubmission marked).
  function withResubmitTag(payloads: TicketInput[]): TicketInput[] {
    if (!resubmitOf) return payloads;
    const [first, ...rest] = payloads;
    return [{ ...first, resubmittedFromId: resubmitOf.ticketid }, ...rest];
  }

  const cardErrors = cards.map(validateCard);
  const canSubmit = cardErrors.every((e) => e === null) && !submitting && !!project;
  // The button stays tappable while the form is incomplete: tapping it shows
  // what's missing (list above the button, red outline on each ticket).
  const blockedReasons = [
    !project && "Choose a project first.",
    ...cardErrors.map((e, i) => e && (cards.length > 1 ? `Ticket ${i + 1}: ${e}` : e)),
  ];

  async function handleSubmit() {
    if (!canSubmit) {
      setTriedSubmit(true);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await createTicketsBatch(withResubmitTag(cards.map(buildPayload)));
      setSent({ count: created.length, resubmit: !!resubmitOf });
    } catch (err) {
      setError(plainError(err, "Unable to submit the tickets."));
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Render states ----------------------------------------------------
  // The confirmation is a screen, not a pop-up: it can't be dismissed by
  // accident, and the form is gone so the same tickets can't be sent twice.
  if (sent) {
    return (
      <Shell>
        <View style={styles.sentCard} accessibilityLiveRegion="polite">
          <View style={styles.sentIcon}><Text style={styles.sentIconText}>✓</Text></View>
          <Text style={styles.sentTitle}>
            {sent.resubmit ? "Request resubmitted" : sent.count > 1 ? "Tickets submitted" : "Ticket submitted"}
          </Text>
          <Text style={styles.sentBody}>
            {sent.resubmit
              ? "Your updated request was sent to your Project Manager."
              : `${sent.count} ${sent.count > 1 ? "requests were" : "request was"} sent to your Project Manager. You'll be notified when they review it.`}
          </Text>
        </View>
        <AppButton label="View my requests" onPress={() => router.replace("/site-manager/my-requests" as Href)} style={styles.sentButton} />
        <AppButton
          label={sent.resubmit ? "Back to tasks" : "Request another ticket"}
          variant="secondary"
          onPress={() => {
            if (sent.resubmit) { router.replace("/site-manager" as Href); return; }
            setCards([emptyCard("c1")]);
            cardSeq.current = 1;
            setTriedSubmit(false);
            setSent(null);
          }}
          style={styles.sentButton}
        />
      </Shell>
    );
  }

  if (loading) {
    return (
      <Shell>
        <View style={styles.loadingCard}><ActivityIndicator color={COLORS.primary} /><Text style={styles.muted}>Loading…</Text></View>
      </Shell>
    );
  }

  if (projects.length === 0) {
    return (
      <Shell>
        <Text style={styles.title}>Request a ticket</Text>
        <View style={styles.loadingCard}>
          <Text style={styles.muted}>You don't have an active project yet. Tickets appear here once a project is assigned to you.</Text>
        </View>
      </Shell>
    );
  }

  // 2+ projects and none chosen → the project gate.
  if (!project) {
    return (
      <Shell>
        <Text style={styles.title}>Which project?</Text>
        <Text style={styles.subtitle}>Choose the project you're raising tickets for.</Text>
        {projects.map((p) => (
          <Pressable key={p.projectid} style={styles.projectChoice} onPress={() => setProject(p)}>
            <Text style={styles.projectChoiceName}>{p.name}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </Shell>
    );
  }

  // Form.
  return (
    <Shell>
      <Text style={styles.title}>{resubmitOf ? "Fix & resubmit" : "Request tickets"}</Text>
      <View style={styles.projectBar}>
        <Text style={styles.projectBarName} numberOfLines={1}>{project.name}</Text>
        {!resubmitOf && projects.length > 1 && (
          <Pressable onPress={() => { setProject(null); setCards([emptyCard("c1")]); cardSeq.current = 1; }}>
            <Text style={styles.changeLink}>Change</Text>
          </Pressable>
        )}
      </View>

      {resubmitOf && (
        <View style={styles.rejectionBanner}>
          <Text style={styles.rejectionBannerLabel}>
            Rejected{resubmitOf.rejectedbyrole ? ` by ${resubmitOf.rejectedbyrole}` : ""}
          </Text>
          <Text style={styles.rejectionBannerReason}>
            {resubmitOf.rejectionreason?.trim() || "No reason given."}
          </Text>
          <Text style={styles.rejectionBannerHint}>
            Fix what's needed below, then resubmit — this will replace the rejected request.
          </Text>
        </View>
      )}

      {savedAt && (
        <Text style={styles.offlineNote}>
          Offline · the project, BOM and vendor lists are the copy saved {savedAtLabel(savedAt)}. You can fill the form, but submitting needs a connection.
        </Text>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}

      {cards.map((card, index) => {
        const onBomUnit = bomUnitFor(card);
        const isMR = card.ticketType === "Material Request";
        const isWork = card.ticketType === "Work Item";
        const isReport = card.ticketType === "Report";
        const notInBom = card.bomItemID === NOT_IN_BOM;
        const k = (field: string) => `${card.id}:${field}`;

        return (
          <View key={card.id} style={[styles.ticketCard, triedSubmit && cardErrors[index] && fieldErrorStyle]}>
            <View style={styles.ticketCardHead}>
              <Text style={styles.ticketCardTitle}>Ticket {index + 1}</Text>
              {cards.length > 1 && (
                <Pressable onPress={() => removeCard(card.id)} hitSlop={8}>
                  <Text style={styles.removeLink}>Remove</Text>
                </Pressable>
              )}
            </View>
            {triedSubmit && cardErrors[index] ? (
              <Text style={styles.cardError}>{cardErrors[index]}</Text>
            ) : null}

            <Dropdown
              label="Type"
              value={card.ticketType}
              open={openKey === k("type")}
              onToggle={() => setOpenKey(openKey === k("type") ? null : k("type"))}
              options={TICKET_TYPES.map((t) => ({
                key: t,
                label: t,
                onPress: () => { updateCard(card.id, { ticketType: t }); setOpenKey(null); },
              }))}
            />

            {isReport && (
              <Field
                label="What's the issue?"
                value={card.reportText}
                onChangeText={(v) => updateCard(card.id, { reportText: v })}
                placeholder="Describe what happened on site and what needs attention"
                multiline
              />
            )}

            {isMR && (
              <Dropdown
                label="BOM item"
                value={
                  notInBom
                    ? "Not in the BOM"
                    : bomItems.find((it) => it.bomItemId === card.bomItemID)?.description ||
                      (bomLoading ? "Loading items…" : "Select a BOM item")
                }
                open={openKey === k("bom")}
                onToggle={() => setOpenKey(openKey === k("bom") ? null : k("bom"))}
                options={[
                  ...bomItems.map((it) => ({
                    key: it.bomItemId,
                    label: `${it.description} (${it.unit})`,
                    onPress: () => { updateCard(card.id, { bomItemID: it.bomItemId }); setOpenKey(null); },
                  })),
                  {
                    key: NOT_IN_BOM,
                    label: "— Not in the BOM —",
                    onPress: () => { updateCard(card.id, { bomItemID: NOT_IN_BOM }); setOpenKey(null); },
                  },
                ]}
              />
            )}

            {((isMR && notInBom) || isWork) && (
              <Field
                label="Material"
                value={card.materialType}
                onChangeText={(v) => updateCard(card.id, { materialType: v })}
                placeholder={isWork ? "e.g. Cement" : "e.g. Pendant light"}
              />
            )}

            {isMR && notInBom && (
              <Field
                label="Why isn't it in the BOM?"
                value={card.notInBomReason}
                onChangeText={(v) => updateCard(card.id, { notInBomReason: v })}
                placeholder="e.g. Additional fixture, billed separately"
                multiline
              />
            )}

            {!isReport && (
              <View style={styles.qtyRow}>
                <View style={styles.qtyCol}>
                  <Field
                    label="Quantity"
                    value={card.quantity}
                    onChangeText={(v) => updateCard(card.id, { quantity: v })}
                    placeholder="0"
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={styles.unitCol}>
                  {onBomUnit ? (
                    <View>
                      <Text style={styles.label}>Unit</Text>
                      <View style={styles.readonlyBox}><Text style={styles.readonlyText}>{onBomUnit}</Text></View>
                    </View>
                  ) : (
                    <Dropdown
                      label="Unit"
                      value={card.unit || "Unit"}
                      open={openKey === k("unit")}
                      onToggle={() => setOpenKey(openKey === k("unit") ? null : k("unit"))}
                      options={UNIT_OPTIONS.map((u) => ({
                        key: u,
                        label: u,
                        onPress: () => { updateCard(card.id, { unit: u }); setOpenKey(null); },
                      }))}
                    />
                  )}
                </View>
              </View>
            )}

            {!isReport && (
              <Dropdown
                label="Preferred vendor (optional)"
                value={card.vendorName || "Not sure yet"}
                open={openKey === k("vendor")}
                onToggle={() => setOpenKey(openKey === k("vendor") ? null : k("vendor"))}
                options={[
                  { key: "__none__", label: "Not sure yet", onPress: () => { updateCard(card.id, { vendorName: "" }); setOpenKey(null); } },
                  ...vendors.map((v) => ({
                    key: v.vendorID,
                    label: v.vendorName,
                    onPress: () => { updateCard(card.id, { vendorName: v.vendorName }); setOpenKey(null); },
                  })),
                ]}
              />
            )}

            {!isReport && (
              <DateField
                label="Needed by (optional)"
                value={card.neededBy}
                onChange={(v) => updateCard(card.id, { neededBy: v })}
                hint="The Project Manager may adjust this date."
              />
            )}

            {isMR && (
              <Field
                label="Requested budget (PHP)"
                value={card.requestedBudget}
                onChangeText={(v) => updateCard(card.id, { requestedBudget: v })}
                placeholder="0.00"
                keyboardType="decimal-pad"
              />
            )}
          </View>
        );
      })}

      {!resubmitOf && (
        <Pressable onPress={addCard} style={styles.addButton}>
          <Text style={styles.addButtonText}>＋ Add another ticket</Text>
        </Pressable>
      )}

      {triedSubmit && <BlockedReasons reasons={blockedReasons} />}
      <Pressable onPress={handleSubmit} disabled={submitting} style={[styles.submitButton, !canSubmit && styles.disabled]}>
        <Text style={styles.submitText}>
          {submitting
            ? resubmitOf ? "Resubmitting…" : "Submitting…"
            : resubmitOf
              ? "Resubmit request"
              : cards.length > 1 ? `Submit ${cards.length} tickets` : "Submit ticket"}
        </Text>
      </Pressable>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <KeyboardScreen
      background={COLORS.bgWarm}
      header={<FlowHeader variant="bar" title="Ticket request" fallback="/site-manager" />}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.eyebrow}>SITE MANAGER</Text>
      {children}
    </KeyboardScreen>
  );
}

function Dropdown({ label, value, open, disabled, onToggle, options }: { label: string; value: string; open: boolean; disabled?: boolean; onToggle: () => void; options: { key: string; label: string; onPress: () => void }[] }) {
  const isPlaceholder = value.startsWith("Select") || value === "Unit" || value === "Not sure yet" || value === "Loading items…";
  return (
    <View style={styles.dropdownWrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable disabled={disabled} onPress={onToggle} style={[styles.dropdownButton, disabled && styles.dropdownDisabled]}>
        <Text style={[styles.dropdownValue, !isPlaceholder && styles.dropdownValueSelected]} numberOfLines={1}>{value}</Text>
        <Text style={styles.chevron}>{open ? "⌃" : "⌄"}</Text>
      </Pressable>
      {open && (
        // A ScrollView, because the BOM can have far more items than fit in
        // 260px. nestedScrollEnabled lets Android scroll it inside the page.
        <View style={styles.dropdownMenu}>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
            {options.length === 0 ? <Text style={styles.noOptions}>No options available</Text> : options.map((option) => (
              <Pressable key={option.key} onPress={option.onPress} style={styles.dropdownOption}><Text style={styles.dropdownOptionText}>{option.label}</Text></Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function Field({ label, value, onChangeText, placeholder, multiline, keyboardType }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; multiline?: boolean; keyboardType?: "default" | "decimal-pad" }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#A79E8C" multiline={multiline} keyboardType={keyboardType} style={[styles.input, multiline && styles.multilineInput]} />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F8F1E8" },
  content: { padding: 20, paddingBottom: 48 },
  eyebrow: { color: COLORS.primary, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  title: { color: COLORS.heading, fontSize: 27, fontWeight: "800", marginTop: 7 },
  subtitle: { color: COLORS.muted, fontSize: 14, lineHeight: 21, marginTop: 10, marginBottom: 6 },
  errorText: { backgroundColor: "#FFF5F3", borderColor: "#F4C7C3", borderRadius: 12, borderWidth: 1, color: "#B42318", lineHeight: 19, marginTop: 14, padding: 12 },
  offlineNote: { backgroundColor: "#FFF4E5", borderColor: "#F5D6A8", borderRadius: 12, borderWidth: 1, color: "#7A4B00", fontSize: 13, lineHeight: 18, marginTop: 14, padding: 12 },
  rejectionBanner: { backgroundColor: "#FFF5F3", borderColor: "#F4C7C3", borderRadius: 14, borderWidth: 1, marginTop: 14, padding: 14 },
  rejectionBannerLabel: { color: "#B42318", fontSize: 11, fontWeight: "800", letterSpacing: 0.5, marginBottom: 4, textTransform: "uppercase" },
  rejectionBannerReason: { color: COLORS.heading, fontSize: 14, fontWeight: "600", lineHeight: 20 },
  rejectionBannerHint: { color: COLORS.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  loadingCard: { alignItems: "center", backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 16, borderWidth: 1, gap: 10, marginTop: 18, padding: 24 },
  muted: { color: COLORS.muted, fontSize: 13, lineHeight: 20, textAlign: "center" },

  // Project gate
  projectChoice: { alignItems: "center", backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 14, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingHorizontal: 16, paddingVertical: 18 },
  projectChoiceName: { color: COLORS.heading, flex: 1, fontSize: 15, fontWeight: "700" },

  // Selected-project bar
  projectBar: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", gap: 12, marginTop: 14 },
  projectBarName: { color: COLORS.heading, flex: 1, fontSize: 15, fontWeight: "700" },
  changeLink: { color: COLORS.primary, fontSize: 13, fontWeight: "700" },

  // Ticket card
  cardError: { color: "#B42318", fontSize: 13, fontWeight: "700", marginBottom: 6 },
  ticketCard: { backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 16, borderWidth: 1, marginTop: 16, padding: 16 },
  ticketCardHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  ticketCardTitle: { color: COLORS.heading, fontSize: 15, fontWeight: "800" },
  removeLink: { color: "#B42318", fontSize: 13, fontWeight: "700" },

  qtyRow: { flexDirection: "row", gap: 12 },
  qtyCol: { flex: 1 },
  unitCol: { width: 120 },
  readonlyBox: { backgroundColor: "#F1E9DD", borderColor: "#E7DDCF", borderRadius: 12, borderWidth: 1, justifyContent: "center", minHeight: 47, paddingHorizontal: 12, marginTop: 0 },
  readonlyText: { color: COLORS.heading, fontSize: 14, fontWeight: "600" },

  label: { color: COLORS.muted, fontSize: 12, fontWeight: "700", marginBottom: 7, marginTop: 12 },
  dropdownWrap: { zIndex: 2 },
  dropdownButton: { alignItems: "center", backgroundColor: "#FFFDFA", borderColor: "#E7DDCF", borderRadius: 12, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 47, paddingHorizontal: 12 },
  dropdownDisabled: { opacity: 0.55 },
  dropdownValue: { color: COLORS.muted, flex: 1, fontSize: 14 },
  dropdownValueSelected: { color: COLORS.heading, fontWeight: "600" },
  chevron: { color: COLORS.primary, fontSize: 19, fontWeight: "800", marginLeft: 8 },
  dropdownMenu: { backgroundColor: "#FFFDFA", borderColor: "#D8CDBD", borderRadius: 12, borderWidth: 1, elevation: 5, marginTop: 5, maxHeight: 260, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 6 },
  dropdownOption: { borderBottomColor: "#EFE7DC", borderBottomWidth: 1, paddingHorizontal: 13, paddingVertical: 13 },
  dropdownOptionText: { color: COLORS.heading, fontSize: 14, fontWeight: "600" },
  noOptions: { color: COLORS.muted, fontSize: 13, padding: 13 },
  field: { marginTop: 2 },
  input: { backgroundColor: "#FFFDFA", borderColor: "#E7DDCF", borderRadius: 12, borderWidth: 1, color: COLORS.heading, fontSize: 14, paddingHorizontal: 12, paddingVertical: 11 },
  multilineInput: { minHeight: 84, textAlignVertical: "top" },

  sentCard: { alignItems: "center", backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 20, borderWidth: 1, gap: 8, marginTop: 18, paddingHorizontal: 24, paddingVertical: 32 },
  sentIcon: { alignItems: "center", backgroundColor: COLORS.successBg, borderRadius: 32, height: 64, justifyContent: "center", width: 64 },
  sentIconText: { color: COLORS.success, fontSize: 32, fontWeight: "800" },
  sentTitle: { color: COLORS.heading, fontSize: 21, fontWeight: "800", marginTop: 6, textAlign: "center" },
  sentBody: { color: COLORS.muted, fontSize: 14, lineHeight: 21, textAlign: "center" },
  sentButton: { marginTop: 12 },
  addButton: { alignItems: "center", borderColor: COLORS.primary, borderRadius: 14, borderStyle: "dashed", borderWidth: 1.5, marginTop: 16, paddingVertical: 14 },
  addButtonText: { color: COLORS.primary, fontSize: 14, fontWeight: "800" },
  submitButton: { alignItems: "center", backgroundColor: COLORS.primary, borderRadius: 14, marginTop: 20, paddingVertical: 15 },
  disabled: { opacity: 0.6 },
  submitText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
});