import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, Stack, router } from "expo-router";

import { COLORS } from "@/constants/expense-flow-colors";
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type AppNotification,
} from "@/lib/api";
import { metaFor, relativeTime, groupByDay, routeForNotification } from "@/lib/notificationMeta";
import { getSession } from "@/lib/auth";
import { describeLoadError, plainError } from "@/lib/sync/messages";
import { useNetwork } from "@/lib/sync/network-context";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { loadNotifications } from "@/lib/cached-api";

const PAGE_SIZE = 30;
type Tab = "Unread" | "All";

export default function NotificationsScreen() {
  const session = getSession();
  const role = session?.user.role;

  const [tab, setTab] = useState<Tab>("Unread");
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isOnline } = useNetwork();
  const [hasMore, setHasMore] = useState(true);
  // A tap that failed (mark all read, load more), shown under the tabs.
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback((which: Tab, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    loadNotifications(which === "Unread", PAGE_SIZE)
      .then(({ data: rows }) => {
        setItems(rows);
        setHasMore(rows.length === PAGE_SIZE);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load your notifications."))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    if (role === "Purchaser" || role === "Site Manager") load(tab);
  }, [tab, role, load]);

  if (!session || (role !== "Purchaser" && role !== "Site Manager")) return <Redirect href="/login" />;

  function loadMore() {
    const oldest = items[items.length - 1];
    if (!oldest) return;
    setLoadingMore(true);
    fetchNotifications({ unreadOnly: tab === "Unread", before: oldest.createdat, limit: PAGE_SIZE })
      .then((rows) => {
        setItems((prev) => [...prev, ...rows]);
        setHasMore(rows.length === PAGE_SIZE);
      })
      .catch((err) =>
        setActionError(isOnline ? plainError(err, "Couldn't load older notifications.") : "You're offline. Older notifications will load when you're back online.")
      )
      .finally(() => setLoadingMore(false));
  }

  async function handleMarkAllRead() {
    setActionError(null);
    try {
      await markAllNotificationsRead();
    } catch (err) {
      setActionError(isOnline ? plainError(err, "Couldn't mark your notifications as read.") : "You're offline. Connect to mark notifications as read.");
      return;
    }
    if (tab === "Unread") setItems([]);
    else setItems((prev) => prev.map((n) => ({ ...n, isread: true })));
  }

  function handleRowPress(n: AppNotification) {
    if (!n.isread) {
      markNotificationRead(n.notificationid).catch(() => {});
      setItems((prev) =>
        tab === "Unread"
          ? prev.filter((x) => x.notificationid !== n.notificationid)
          : prev.map((x) => (x.notificationid === n.notificationid ? { ...x, isread: true } : x))
      );
    }
    const route = routeForNotification(n, role as "Purchaser" | "Site Manager");
    if (route) router.push(route);
  }

  const unreadCount = items.filter((n) => !n.isread).length;
  const grouped = groupByDay(items);

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Notifications</Text>
          {((tab === "All" && unreadCount > 0) || (tab === "Unread" && items.length > 0)) && (
            <Pressable onPress={handleMarkAllRead}>
              <Text style={styles.markAll}>Mark all read</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.tabsRow}>
        {(["Unread", "All"] as Tab[]).map((key) => (
          <Pressable key={key} onPress={() => setTab(key)} style={styles.tabBtn} hitSlop={10}>
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{key}</Text>
            {tab === key && <View style={styles.tabUnderline} />}
          </Pressable>
        ))}
      </View>

      {actionError && (
        <View style={styles.errorCard} accessibilityLiveRegion="polite">
          <Text style={styles.errorBody}>{actionError}</Text>
        </View>
      )}

      {error && !isOnline ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>You're offline</Text>
          <Text style={styles.errorBody}>Your notifications will load when you're back online.</Text>
        </View>
      ) : error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Couldn't load your notifications</Text>
          <Text style={styles.errorBody}>{describeLoadError(error, true)}</Text>
          <Pressable onPress={() => load(tab)} style={styles.retryButton}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={([label]) => label}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(tab, true)} />}
          ListEmptyComponent={
            loading ? (
              <View style={styles.emptyCard}>
                <ActivityIndicator color={COLORS.primary} />
                <Text style={styles.emptyBody}>Loading…</Text>
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>
                  {tab === "Unread" ? "You're all caught up" : "No notifications yet"}
                </Text>
                <Text style={styles.emptyBody}>
                  {tab === "Unread"
                    ? "Nothing new to review right now."
                    : "Activity on your tickets and tasks will show up here."}
                </Text>
              </View>
            )
          }
          renderItem={({ item: [label, rows] }) => (
            <View style={styles.group}>
              <Text style={styles.groupLabel}>{label}</Text>
              {rows.map((n) => {
                const { icon, bg, fg, fallback } = metaFor(n.type);
                const clickable = !n.isread || !!routeForNotification(n, role as "Purchaser" | "Site Manager");
                return (
                  <Pressable
                    key={n.notificationid}
                    onPress={clickable ? () => handleRowPress(n) : undefined}
                    style={[styles.row, !n.isread && styles.rowUnread]}
                  >
                    <View style={[styles.rowIcon, { backgroundColor: bg }]}>
                      <IconSymbol name={icon} size={16} color={fg} />
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={[styles.rowMessage, !n.isread && styles.rowMessageUnread]}>
                        {n.message || fallback}
                      </Text>
                      <Text style={styles.rowTime}>{relativeTime(n.createdat)}</Text>
                    </View>
                    {!n.isread && <View style={styles.dot} />}
                  </Pressable>
                );
              })}
            </View>
          )}
          ListFooterComponent={
            hasMore && items.length > 0 ? (
              <Pressable onPress={loadMore} style={styles.loadMore} disabled={loadingMore}>
                <Text style={styles.loadMoreText}>{loadingMore ? "Loading…" : "Load more"}</Text>
              </Pressable>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F8F1E8" },
  topBar: { paddingHorizontal: 20, paddingTop: 14 },
  backButton: { alignSelf: "flex-start", marginBottom: 14 },
  backText: { color: COLORS.primary, fontSize: 14, fontWeight: "700" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: COLORS.heading, fontSize: 25, fontWeight: "800" },
  markAll: { color: COLORS.primary, fontSize: 13, fontWeight: "700" },

  tabsRow: { flexDirection: "row", gap: 20, paddingHorizontal: 20, marginTop: 16, borderBottomWidth: 1, borderBottomColor: "#E7DDCF" },
  tabBtn: { paddingBottom: 10, minHeight: 36, justifyContent: "flex-start" },
  tabText: { color: COLORS.muted, fontSize: 14, fontWeight: "700" },
  tabTextActive: { color: COLORS.heading },
  tabUnderline: { height: 2, backgroundColor: COLORS.primary, marginTop: 8, borderRadius: 1 },

  list: { paddingHorizontal: 20, paddingBottom: 36, paddingTop: 16 },

  group: { marginBottom: 18 },
  groupLabel: { color: COLORS.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 8 },

  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: COLORS.card,
    borderColor: "#E7DDCF",
    borderWidth: 1,
    borderRadius: 14,
    padding: 13,
    marginBottom: 8,
  },
  rowUnread: { backgroundColor: "#FFF4E8", borderColor: "#F3DDBE" },
  rowIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  rowBody: { flex: 1 },
  rowMessage: { color: COLORS.heading, fontSize: 13, lineHeight: 19 },
  rowMessageUnread: { fontWeight: "700" },
  rowTime: { color: COLORS.muted, fontSize: 11, marginTop: 3 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary, marginTop: 6 },

  loadMore: { alignItems: "center", backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderWidth: 1, borderRadius: 12, paddingVertical: 12, marginTop: 4 },
  loadMoreText: { color: COLORS.primary, fontSize: 13, fontWeight: "700" },

  emptyCard: { alignItems: "center", backgroundColor: COLORS.card, borderColor: "#E7DDCF", borderWidth: 1, borderRadius: 16, gap: 10, marginTop: 18, paddingHorizontal: 24, paddingVertical: 28 },
  emptyTitle: { color: COLORS.heading, fontSize: 15, fontWeight: "800" },
  emptyBody: { color: COLORS.muted, fontSize: 13, lineHeight: 19, textAlign: "center" },

  errorCard: { backgroundColor: "#FFF5F3", borderColor: "#F4C7C3", borderWidth: 1, borderRadius: 16, marginHorizontal: 20, marginTop: 14, padding: 16 },
  errorTitle: { color: "#B42318", fontSize: 15, fontWeight: "800" },
  errorBody: { color: "#8C2D24", fontSize: 13, lineHeight: 19, marginTop: 6 },
  retryButton: { alignSelf: "flex-start", backgroundColor: COLORS.primary, borderRadius: 10, marginTop: 12, paddingHorizontal: 13, paddingVertical: 9 },
  retryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
});