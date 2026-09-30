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

export default function TicketRequestScreen() {
  const session = getSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [vendors, setVendors] = useState<ApprovedVendor[]>([]);
  const [projectID, setProjectID] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [materialType, setMaterialType] = useState("");
  const [quantity, setQuantity] = useState("");
  const [requestedBudget, setRequestedBudget] = useState("");
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

  async function handleSubmit() {
    setError(null);
    const numericQuantity = Number(quantity);
    const numericBudget = Number(requestedBudget);

    if (!projectID || !subject.trim() || !materialType.trim() || !vendorName || !Number.isFinite(numericQuantity) || numericQuantity <= 0 || !Number.isFinite(numericBudget) || numericBudget < 0) {
      setError("Select a project and vendor, then complete the subject, material, quantity, and requested budget.");
      return;
    }

    setSubmitting(true);
    try {
      const ticket = await createTicket({
        projectID,
        ticketType: "Material Request",
        subject: subject.trim(),
        description: description.trim() || undefined,
        materialType: materialType.trim(),
        quantity: numericQuantity,
        vendorName,
        requestedBudget: numericBudget,
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
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.eyebrow}>SITE MANAGER</Text>
        <Text style={styles.title}>Request a ticket</Text>
        <Text style={styles.subtitle}>Send a Material Request to your Project Manager for acknowledgement and assignment.</Text>

        {error && <Text style={styles.errorText}>{error}</Text>}
        {loading ? (
          <View style={styles.loadingCard}><ActivityIndicator color={COLORS.primary} /><Text style={styles.muted}>Loading projects and approved vendors…</Text></View>
        ) : (
          <>
            <Text style={styles.label}>Project</Text>
            <View style={styles.choiceList}>
              {projects.map((project) => (
                <Pressable key={project.projectid} onPress={() => setProjectID(project.projectid)} style={[styles.choice, projectID === project.projectid && styles.choiceSelected]}>
                  <Text style={[styles.choiceText, projectID === project.projectid && styles.choiceTextSelected]}>{project.name}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Preferred vendor</Text>
            <View style={styles.choiceList}>
              {vendors.map((vendor) => (
                <Pressable key={vendor.vendorID} onPress={() => setVendorName(vendor.vendorName)} style={[styles.choice, vendorName === vendor.vendorName && styles.choiceSelected]}>
                  <Text style={[styles.choiceText, vendorName === vendor.vendorName && styles.choiceTextSelected]}>{vendor.vendorName}</Text>
                </Pressable>
              ))}
            </View>

            <Field label="Subject" value={subject} onChangeText={setSubject} placeholder="Briefly describe the request" />
            <Field label="Description / context" value={description} onChangeText={setDescription} placeholder="Add details about what is needed" multiline />
            <Field label="Material type" value={materialType} onChangeText={setMaterialType} placeholder="e.g. Cement" />
            <Field label="Quantity" value={quantity} onChangeText={setQuantity} placeholder="0" keyboardType="decimal-pad" />
            <Field label="Requested budget (PHP)" value={requestedBudget} onChangeText={setRequestedBudget} placeholder="0.00" keyboardType="decimal-pad" />

            <Pressable onPress={handleSubmit} disabled={submitting} style={[styles.submitButton, submitting && styles.disabled]}>
              <Text style={styles.submitText}>{submitting ? "Submitting…" : "Submit ticket request"}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChangeText, placeholder, multiline, keyboardType }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; multiline?: boolean; keyboardType?: "default" | "decimal-pad" }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#A79E8C"
        multiline={multiline}
        keyboardType={keyboardType}
        style={[styles.input, multiline && styles.multilineInput]}
      />
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
  subtitle: { color: COLORS.muted, fontSize: 14, lineHeight: 21, marginTop: 10, marginBottom: 22 },
  errorText: { backgroundColor: "#FFF5F3", borderColor: "#F4C7C3", borderRadius: 12, borderWidth: 1, color: "#B42318", lineHeight: 19, marginBottom: 16, padding: 12 },
  loadingCard: { alignItems: "center", backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 16, borderWidth: 1, gap: 10, padding: 24 },
  muted: { color: COLORS.muted, fontSize: 13 },
  label: { color: COLORS.muted, fontSize: 12, fontWeight: "700", marginBottom: 7, marginTop: 12 },
  choiceList: { gap: 8 },
  choice: { backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 12, borderWidth: 1, padding: 13 },
  choiceSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  choiceText: { color: COLORS.heading, fontSize: 13, fontWeight: "600" },
  choiceTextSelected: { color: "#FFFFFF" },
  field: { marginTop: 2 },
  input: { backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderRadius: 12, borderWidth: 1, color: COLORS.heading, fontSize: 14, paddingHorizontal: 12, paddingVertical: 11 },
  multilineInput: { minHeight: 84, textAlignVertical: "top" },
  submitButton: { alignItems: "center", backgroundColor: COLORS.primary, borderRadius: 14, marginTop: 24, paddingVertical: 15 },
  disabled: { opacity: 0.6 },
  submitText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
});
