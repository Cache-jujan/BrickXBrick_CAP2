    import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { fetchAssignedTickets, fetchActiveProjects, type Ticket, type Project } from "@/lib/api";

export type SelectedTicket = {
  ticketId: string;
  projectId: string;
  projectName: string;
  subject: string;
};

type Props = {
  visible: boolean;
  onSelect: (ticket: SelectedTicket) => void;
  onClose: () => void;
};

const COLORS = {
  bg: "#F8F1E8",
  ink: "#1A1A1A",
  card: "#FFFFFF",
  border: "#EDE6D9",
  muted: "#8A8272",
  danger: "#C1121F",
};

export function TicketPickerModal({ visible, onSelect, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [projectsById, setProjectsById] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([fetchAssignedTickets(), fetchActiveProjects()])
      .then(([ticketList, projectList]) => {
        if (cancelled) return;
        const nameById: Record<string, string> = {};
        for (const p of projectList) nameById[p.projectid] = p.name;
        setProjectsById(nameById);
        setTickets(ticketList);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? "Something went wrong.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Link to a Material Request</Text>
          <Text style={styles.subtitle}>
            Select the ticket this expense is fulfilling.
          </Text>

          {loading && (
            <View style={styles.centerBox}>
              <ActivityIndicator />
            </View>
          )}

          {!loading && error && (
            <View style={styles.centerBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {!loading && !error && tickets.length === 0 && (
            <View style={styles.centerBox}>
              <Text style={styles.emptyText}>
                No open Material Request tickets are assigned to you right now.
              </Text>
            </View>
          )}

          {!loading && !error && tickets.length > 0 && (
            <FlatList
              data={tickets}
              keyExtractor={(t) => t.ticketid}
              style={styles.list}
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                  onPress={() =>
                    onSelect({
                      ticketId: item.ticketid,
                      projectId: item.projectid,
                      projectName: projectsById[item.projectid] ?? "Unknown project",
                      subject: item.subject,
                    })
                  }
                >
                  <Text style={styles.rowProject}>
                    {projectsById[item.projectid] ?? "Unknown project"}
                  </Text>
                  <Text style={styles.rowSubject} numberOfLines={1}>
                    {item.subject}
                  </Text>
                </Pressable>
              )}
            />
          )}

          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(26,26,26,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 24,
    maxHeight: "75%",
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginBottom: 12,
  },
  title: { fontSize: 19, fontWeight: "800", color: COLORS.ink },
  subtitle: { fontSize: 13, color: COLORS.muted, marginTop: 2, marginBottom: 14 },
  centerBox: { paddingVertical: 30, alignItems: "center" },
  errorText: { color: COLORS.danger, fontSize: 13, textAlign: "center" },
  emptyText: { color: COLORS.muted, fontSize: 13, textAlign: "center" },
  list: { flexGrow: 0 },
  row: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  rowProject: { fontSize: 14, fontWeight: "700", color: COLORS.ink },
  rowSubject: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  closeBtn: { marginTop: 10, alignSelf: "center", paddingVertical: 8, paddingHorizontal: 16 },
  closeBtnText: { color: COLORS.danger, fontWeight: "600", fontSize: 13 },
});