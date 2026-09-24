import React, { useCallback, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useFocusEffect } from "expo-router";

import {
  fetchAllAssignedTickets,
  fetchActiveProjects,
  type Ticket,
  type Project,
} from "@/lib/api";
import { useExpenseDraft } from "@/lib/expense-draft-context";
import { COLORS } from "@/constants/expense-flow-colors";

type FilterKey = "All" | "Pending" | "Completed";

// "Pending" here means actionable (Acknowledged, not yet expensed);
// "Completed" means Resolved. No priority/due-date field exists on
// Tickets yet, so those aren't shown.
function toBucket(
  status: string
): "Pending" | "Completed" | null {
  if (status === "Acknowledged") return "Pending";
  if (status === "Resolved") return "Completed";
  return null;
}

export default function HomeScreen() {
  const { setTicket, reset } = useExpenseDraft();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [projectsById, setProjectsById] = useState<
    Record<string, Project>
  >({});
  const [filter, setFilter] = useState<FilterKey>("Pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);

    try {
      const [ticketList, projectList] = await Promise.all([
        fetchAllAssignedTickets(),
        fetchActiveProjects(),
      ]);

      const byId: Record<string, Project> = {};

      for (const p of projectList) {
        byId[p.projectid] = p;
      }

      setProjectsById(byId);
      setTickets(ticketList);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const actionable = tickets.filter(
    (t) => toBucket(t.status) !== null
  );

  const visible = actionable
    .filter(
      (t) =>
        filter === "All" ||
        toBucket(t.status) === filter
    )
    .sort(
      (a, b) =>
        new Date(b.createdat).getTime() -
        new Date(a.createdat).getTime()
    );

  const counts = {
    All: actionable.length,
    Pending: actionable.filter(
      (t) => toBucket(t.status) === "Pending"
    ).length,
    Completed: actionable.filter(
      (t) => toBucket(t.status) === "Completed"
    ).length,
  };

  function openTicket(ticket: Ticket) {
    reset();

    const project = projectsById[ticket.projectid];

    setTicket({
      ticketId: ticket.ticketid,
      projectId: ticket.projectid,
      projectName: project?.name ?? "Unknown project",
      subject: ticket.subject,
      budget: project?.budget,
    });

    router.push("/expense/capture");
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.brand}>Brick x Brick</Text>
      </View>

      <View style={styles.filterRow}>
        {(["All", "Pending", "Completed"] as FilterKey[]).map(
          (key) => (
            <Pressable
              key={key}
              onPress={() => setFilter(key)}
              style={[
                styles.chip,
                filter === key && styles.chipActive,
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  filter === key && styles.chipTextActive,
                ]}
              >
                {key} ({counts[key]})
              </Text>
            </Pressable>
          )
        )}
      </View>

      {error && (
        <Text style={styles.errorText}>{error}</Text>
      )}

      <FlatList
        data={visible}
        keyExtractor={(t) => t.ticketid}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
          />
        }
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.emptyText}>
              No tickets in this view yet.
            </Text>
          ) : null
        }
        renderItem={({ item }) => {
          const project = projectsById[item.projectid];
          const actionableNow =
            toBucket(item.status) === "Pending";

          const Card = (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardBadge}>
                  {item.tickettype}
                </Text>

                {project?.budget && (
                  <Text style={styles.budgetPill}>
                    ₱
                    {Number(project.budget).toLocaleString()}
                  </Text>
                )}
              </View>

              <Text
                style={styles.cardTitle}
                numberOfLines={2}
              >
                {item.subject}
              </Text>

              <Text style={styles.cardMeta}>
                {project?.name ?? "Unknown project"}
              </Text>

              <View style={styles.cardFooterRow}>
                <Text style={styles.cardFooterText}>
                  {new Date(
                    item.createdat
                  ).toLocaleDateString()}
                </Text>

                {actionableNow ? (
                  <View style={styles.addBtn}>
                    <Text style={styles.addBtnText}>
                      + Add Expense
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.completedBadge}>
                    Resolved
                  </Text>
                )}
              </View>
            </View>
          );

          return actionableNow ? (
            <Pressable
              onPress={() => openTicket(item)}
            >
              {Card}
            </Pressable>
          ) : (
            Card
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },

  brand: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.heading,
  },

  filterRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 8,
  },

  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },

  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },

  chipText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.muted,
  },

  chipTextActive: {
    color: "#FFF",
  },

  errorText: {
    color: "#C1121F",
    paddingHorizontal: 16,
    marginBottom: 8,
    fontSize: 12,
  },

  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 10,
  },

  emptyText: {
    textAlign: "center",
    color: COLORS.muted,
    marginTop: 40,
  },

  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
  },

  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },

  cardBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.primary,
  },

  budgetPill: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.heading,
  },

  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.heading,
    marginBottom: 4,
  },

  cardMeta: {
    fontSize: 12,
    color: COLORS.muted,
    marginBottom: 10,
  },

  cardFooterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  cardFooterText: {
    fontSize: 11,
    color: COLORS.muted,
  },

  addBtn: {
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },

  addBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.primary,
  },

  completedBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.success,
  },
});