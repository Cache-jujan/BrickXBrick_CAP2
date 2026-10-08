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
  fetchOpenRequests,
  type OpenRequest,
  type Ticket,
  type Project,
} from "@/lib/api";
import { formatQty } from "@/lib/money";
import { useExpenseDraft } from "@/lib/expense-draft-context";
import { getSession } from "@/lib/auth";
import { COLORS } from "@/constants/expense-flow-colors";

type FilterKey = "All" | "Pending" | "Completed";

// Purchasers can act on Acknowledged tickets and see Resolved tickets as
// completed. Site Managers see only their own Resolved Material Requests,
// which are ready for expense capture. No priority/due-date field exists.
function toBucket(
  status: string
): "Pending" | "Completed" | null {
  if (status === "Acknowledged") return "Pending";
  if (status === "Resolved") return "Completed";
  return null;
}

export default function HomeScreen() {
  const { setTicket, reset, startSplit } = useExpenseDraft();
  const isSiteManager = getSession()?.user.role === "Site Manager";

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [projectsById, setProjectsById] = useState<
    Record<string, Project>
  >({});
  const [filter, setFilter] = useState<FilterKey>(isSiteManager ? "Completed" : "Pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openRequests, setOpenRequests] = useState<OpenRequest[]>([]);

  const load = useCallback(async () => {
    setError(null);

    try {
      const [ticketList, projectList] = await Promise.all([
        fetchAllAssignedTickets(isSiteManager ? "Site Manager" : "Purchaser"),
        fetchActiveProjects(),
      ]);

      const byId: Record<string, Project> = {};

      for (const p of projectList) {
        byId[p.projectid] = p;
      }

      setProjectsById(byId);
      setTickets(ticketList);

      // F8 To-buy list (Purchaser only). A failure here must not hide the tickets.
      if (!isSiteManager) {
        try {
          setOpenRequests(await fetchOpenRequests());
        } catch {
          setOpenRequests([]);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }, [isSiteManager]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const actionable = tickets.filter((t) => isSiteManager
    ? t.status === "Resolved" && t.tickettype === "Material Request"
    : toBucket(t.status) !== null);

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

  // To-buy list: open requests grouped by material (lowercased, trimmed).
  const toBuy = Object.values(
    openRequests.reduce<Record<string, { material: string; total: number; requests: number; projects: string[] }>>(
      (groups, request) => {
        const key = request.materialType.trim().toLowerCase();
        const group = groups[key] ?? { material: request.materialType.trim(), total: 0, requests: 0, projects: [] };
        group.total += Number(request.remainingQuantity);
        group.requests += 1;
        if (!group.projects.includes(request.projectName)) group.projects.push(request.projectName);
        groups[key] = group;
        return groups;
      },
      {}
    )
  );

  function startSplitReceipt() {
    startSplit();
    router.push("/expense/capture");
  }

  function openTicket(ticket: Ticket) {
    reset();

    const project = projectsById[ticket.projectid];

    setTicket({
      ticketId: ticket.ticketid,
      projectId: ticket.projectid,
      projectName: project?.name ?? "Unknown project",
      subject: ticket.subject,
      budget: ticket.approvedbudget == null ? undefined : String(ticket.approvedbudget),
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
        ListHeaderComponent={
          isSiteManager ? null : (
            <View style={styles.toBuyBox}>
              <View style={styles.toBuyHeader}>
                <Text style={styles.toBuyTitle}>To buy</Text>
                <Pressable onPress={startSplitReceipt} style={styles.splitBtn}>
                  <Text style={styles.splitBtnText}>Split Receipt</Text>
                </Pressable>
              </View>
              {toBuy.length === 0 ? (
                <Text style={styles.cardMeta}>No open requests right now.</Text>
              ) : (
                toBuy.map((group) => (
                  <View key={group.material.toLowerCase()} style={styles.toBuyRow}>
                    <Text style={styles.toBuyLine}>
                      {group.material} · {formatQty(group.total)} · {group.requests} {group.requests === 1 ? "request" : "requests"}
                    </Text>
                    <View style={styles.projectTags}>
                      {group.projects.map((name) => (
                        <Text key={name} style={styles.projectTag}>{name}</Text>
                      ))}
                    </View>
                  </View>
                ))
              )}
            </View>
          )
        }
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
          const actionableNow = isSiteManager
            ? item.status === "Resolved" && item.tickettype === "Material Request"
            : item.status === "Acknowledged";

          const Card = (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardBadge}>
                  {item.tickettype}
                </Text>

                {item.approvedbudget != null && (
                  <Text style={styles.budgetPill}>
                    ₱
                    {Number(item.approvedbudget).toLocaleString()}
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

  toBuyBox: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 6,
  },

  toBuyHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },

  toBuyTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.heading,
  },

  splitBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },

  splitBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFF",
  },

  toBuyRow: {
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },

  toBuyLine: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.heading,
  },

  projectTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },

  projectTag: {
    fontSize: 10,
    color: COLORS.muted,
    backgroundColor: COLORS.bg,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },

  completedBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.success,
  },
});
