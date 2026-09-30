import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";

import { COLORS } from "@/constants/expense-flow-colors";
import {
  createTicket,
  fetchActiveProjects,
  fetchApprovedVendors,
  type ApprovedVendor,
  type Project,
} from "@/lib/api";
import { getSession } from "@/lib/auth";

type TicketType = "Material Request" | "Work Item" | "Report";

export default function TicketRequestScreen() {
  const session = getSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [vendors, setVendors] = useState<ApprovedVendor[]>([]);
  const [projectID, setProjectID] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [ticketType, setTicketType] = useState<TicketType>("Material Request");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [materialType, setMaterialType] = useState("");
  const [quantity, setQuantity] = useState("");
  const [requestedBudget, setRequestedBudget] = useState("");
  const [openDropdown, setOpenDropdown] = useState<"project" | "vendor" | "type" | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || session.user.role !== "Site Manager") return;

    Promise.all([fetchActiveProjects(), fetchApprovedVendors()])
      .then(([projectList, vendorList]) => {
        setProjects(projectList);
        setVendors(vendorList);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load request options."))
      .finally(() => setLoading(false));
  }, [session?.user.role]);

  if (!session || session.user.role !== "Site Manager") return <Redirect href="/login" />;

  const needsProcurementDetails = ticketType === "Material Request" || ticketType === "Work Item";

  function chooseType(value: TicketType) {
    setTicketType(value);
    setOpenDropdown(null);
    if (value === "Report") {
      setVendorName("");
      setMaterialType("");
      setQuantity("");
      setRequestedBudget("");
    }
  }

  async function handleSubmit() {
    setError(null);
    const numericQuantity = Number(quantity);
    const numericBudget = Number(requestedBudget);

    const invalidBase = !projectID || !subject.trim();
    const invalidProcurement = needsProcurementDetails && (
      !materialType.trim() || !vendorName || !Number.isFinite(numericQuantity) || numericQuantity <= 0
    );
    const invalidBudget = ticketType === "Material Request" && (
      !Number.isFinite(numericBudget) || numericBudget < 0
    );

    if (invalidBase || invalidProcurement || invalidBudget) {
      setError(ticketType === "Report"
        ? "Select a project and complete the subject."
        : "Select a project and vendor, then complete the subject, material, quantity, and budget fields.");
      return;
    }

    setSubmitting(true);
    try {
      const ticket = await createTicket({
        projectID,
        ticketType,
        subject: subject.trim(),
        description: description.trim() || undefined,
        ...(needsProcurementDetails ? {
          materialType: materialType.trim(),
          quantity: numericQuantity,
          vendorName,
          ...(ticketType === "Material Request" ? { requestedBudget: numericBudget } : {}),
        } : {}),
      });
      Alert.alert("Ticket submitted", `Ticket “${ticket.subject || subject.trim()}” was sent to your Project Manager.`, [
        { text: "Done", onPress: () => router.replace("/site-manager") },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit the ticket.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} style={styles.backButton}><Text style={styles.backText}>‹ Back</Text></Pressable>
        <Text style={styles.eyebrow}>SITE MANAGER</Text>
        <Text style={styles.title}>Request a ticket</Text>
        <Text style={styles.subtitle}>Create a request for your Project Manager, just like the web form.</Text>

        {error && <Text style={styles.errorText}>{error}</Text>}
        {loading ? (
          <View style={styles.loadingCard}><ActivityIndicator color={COLORS.primary} /><Text style={styles.muted}>Loading projects and approved vendors…</Text></View>
        ) : (
          <>
            <Dropdown
              label="Project"
              value={projects.find((project) => project.projectid === projectID)?.name || "Select a project"}
              open={openDropdown === "project"}
              onToggle={() => setOpenDropdown(openDropdown === "project" ? null : "project")}
              options={projects.map((project) => ({ key: project.projectid, label: project.name, onPress: () => { setProjectID(project.projectid); setOpenDropdown(null); } }))}
            />

            <Dropdown
              label="Preferred vendor"
              value={vendorName || (needsProcurementDetails ? "Select an approved vendor" : "Not required for Report")}
              open={openDropdown === "vendor"}
              disabled={!needsProcurementDetails}
              onToggle={() => setOpenDropdown(openDropdown === "vendor" ? null : "vendor")}
              options={vendors.map((vendor) => ({ key: vendor.vendorID, label: vendor.vendorName, onPress: () => { setVendorName(vendor.vendorName); setOpenDropdown(null); } }))}
            />

            <Dropdown
              label="Ticket type"
              value={ticketType}
              open={openDropdown === "type"}
              onToggle={() => setOpenDropdown(openDropdown === "type" ? null : "type")}
              options={[
                "Material Request",
                "Work Item",
                "Report",
              ].map((value) => ({ key: value, label: value, onPress: () => chooseType(value as TicketType) }))}
            />

            <Field label="Subject" value={subject} onChangeText={setSubject} placeholder="Briefly describe the request" />
            <Field label="Description / context" value={description} onChangeText={setDescription} placeholder="Add details about what is needed" multiline />

            {needsProcurementDetails && (
              <>
                <Text style={styles.sectionLabel}>Procurement details</Text>
                <Field label="Material type" value={materialType} onChangeText={setMaterialType} placeholder="e.g. Cement" />
                <Field label="Quantity" value={quantity} onChangeText={setQuantity} placeholder="0" keyboardType="decimal-pad" />
                {ticketType === "Material Request" && <Field label="Requested budget (PHP)" value={requestedBudget} onChangeText={setRequestedBudget} placeholder="0.00" keyboardType="decimal-pad" />}
              </>
            )}

            <Pressable onPress={handleSubmit} disabled={submitting} style={[styles.submitButton, submitting && styles.disabled]}>
              <Text style={styles.submitText}>{submitting ? "Submitting…" : "Submit ticket request"}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Dropdown({ label, value, open, disabled, onToggle, options }: { label: string; value: string; open: boolean; disabled?: boolean; onToggle: () => void; options: { key: string; label: string; onPress: () => void }[] }) {
  return (
    <View style={styles.dropdownWrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable disabled={disabled} onPress={onToggle} style={[styles.dropdownButton, disabled && styles.dropdownDisabled]}>
        <Text style={[styles.dropdownValue, !value.startsWith("Select") && !value.startsWith("Not required") && styles.dropdownValueSelected]}>{value}</Text>
        <Text style={styles.chevron}>{open ? "⌃" : "⌄"}</Text>
      </Pressable>
      {open && (
        <View style={styles.dropdownMenu}>
          {options.length === 0 ? <Text style={styles.noOptions}>No options available</Text> : options.map((option) => (
            <Pressable key={option.key} onPress={option.onPress} style={styles.dropdownOption}><Text style={styles.dropdownOptionText}>{option.label}</Text></Pressable>
          ))}
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
  content: { padding: 20, paddingBottom: 40 },
  backButton: { alignSelf: "flex-start", marginBottom: 20 },
  backText: { color: COLORS.primary, fontSize: 14, fontWeight: "700" },
  eyebrow: { color: COLORS.primary, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  title: { color: COLORS.heading, fontSize: 27, fontWeight: "800", marginTop: 7 },
  subtitle: { color: COLORS.muted, fontSize: 14, lineHeight: 21, marginTop: 10, marginBottom: 18 },
  errorText: { backgroundColor: "#FFF5F3", borderColor: "#F4C7C3", borderRadius: 12, borderWidth: 1, color: "#B42318", lineHeight: 19, marginBottom: 16, padding: 12 },
  loadingCard: { alignItems: "center", backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 16, borderWidth: 1, gap: 10, padding: 24 },
  muted: { color: COLORS.muted, fontSize: 13 },
  sectionLabel: { color: COLORS.heading, fontSize: 13, fontWeight: "800", marginTop: 22, marginBottom: 2 },
  label: { color: COLORS.muted, fontSize: 12, fontWeight: "700", marginBottom: 7, marginTop: 12 },
  dropdownWrap: { zIndex: 2 },
  dropdownButton: { alignItems: "center", backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 12, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 47, paddingHorizontal: 12 },
  dropdownDisabled: { opacity: 0.55 },
  dropdownValue: { color: COLORS.muted, flex: 1, fontSize: 14 },
  dropdownValueSelected: { color: COLORS.heading, fontWeight: "600" },
  chevron: { color: COLORS.primary, fontSize: 19, fontWeight: "800", marginLeft: 8 },
  dropdownMenu: { backgroundColor: COLORS.card, borderColor: "#D8CDBD", borderRadius: 12, borderWidth: 1, elevation: 5, marginTop: 5, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 6 },
  dropdownOption: { borderBottomColor: "#EFE7DC", borderBottomWidth: 1, paddingHorizontal: 13, paddingVertical: 13 },
  dropdownOptionText: { color: COLORS.heading, fontSize: 14, fontWeight: "600" },
  noOptions: { color: COLORS.muted, fontSize: 13, padding: 13 },
  field: { marginTop: 2 },
  input: { backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 12, borderWidth: 1, color: COLORS.heading, fontSize: 14, paddingHorizontal: 12, paddingVertical: 11 },
  multilineInput: { minHeight: 84, textAlignVertical: "top" },
  submitButton: { alignItems: "center", backgroundColor: COLORS.primary, borderRadius: 14, marginTop: 24, paddingVertical: 15 },
  disabled: { opacity: 0.6 },
  submitText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
});
