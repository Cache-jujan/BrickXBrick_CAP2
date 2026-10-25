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
import { Redirect, Stack, router } from "expo-router";

import { COLORS, FONT } from "@/constants/expense-flow-colors";
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
import { FlowHeader } from "@/components/flow-header";
import { Screen } from "@/components/screen";
import { useLocale } from "@/lib/i18n-context";

const PAGE_SIZE = 30;
type Tab = "Unread" | "All";

export default function NotificationsScreen() {
  const { t, tv, intlLocale } = useLocale();
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
      .catch((err) => setError(err instanceof Error ? err.message : t("errors.load_notifications")))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the load callback must stay stable; a language change must not refetch
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
        setActionError(isOnline ? plainError(err, t("mn.err_older"), t) : t("mn.offline_older"))
      )
      .finally(() => setLoadingMore(false));
  }

  async function handleMarkAllRead() {
    setActionError(null);
    try {
      await markAllNotificationsRead();
    } catch (err) {
      setActionError(isOnline ? plainError(err, t("mn.err_mark"), t) : t("mn.offline_mark"));
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
    <Screen
      header={
        <FlowHeader
          title={t("nav.notifications")}
          right={
            (tab === "All" && unreadCount > 0) || (tab === "Unread" && items.length > 0) ? (
              <Pressable onPress={handleMarkAllRead} hitSlop={8} style={styles.markAllButton} accessibilityRole="button">
                <Text style={styles.markAll}>{t("notifications.mark_all_read")}</Text>
              </Pressable>
            ) : null
          }
        />
      }
    >
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.tabsRow}>
        {(["Unread", "All"] as Tab[]).map((key) => (
          <Pressable key={key} onPress={() => setTab(key)} style={styles.tabBtn} hitSlop={10}>
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{key === "Unread" ? t("notifications.tab_unread") : t("common.all")}</Text>
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
          <Text style={styles.errorTitle}>{t("mn.offline_title")}</Text>
          <Text style={styles.errorBody}>{t("mn.offline_body")}</Text>
        </View>
      ) : error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>{t("mn.cant_load")}</Text>
          <Text style={styles.errorBody}>{describeLoadError(error, true, t)}</Text>
          <Pressable onPress={() => load(tab)} style={styles.retryButton}>
            <Text style={styles.retryText}>{t("common.try_again")}</Text>
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
                <Text style={styles.emptyBody}>{t("common.loading")}</Text>
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>
                  {tab === "Unread" ? t("notifications.caught_up_title") : t("notifications.none_yet")}
                </Text>
                <Text style={styles.emptyBody}>
                  {tab === "Unread" ? t("notifications.nothing_new") : t("mn.empty_all")}
                </Text>
              </View>
            )
          }
          renderItem={({ item: [label, rows] }) => (
            <View style={styles.group}>
              <Text style={styles.groupLabel}>{tv("notifications.group", label)}</Text>
              {rows.map((n) => {
                const { icon, bg, fg, fallbackKey } = metaFor(n.type);
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
                        {n.message || t(fallbackKey)}
                      </Text>
                      <Text style={styles.rowTime}>{relativeTime(n.createdat, t, intlLocale)}</Text>
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
                <Text style={styles.loadMoreText}>{loadingMore ? t("common.loading") : t("common.load_more")}</Text>
              </Pressable>
            ) : null
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  markAllButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  topBar: { paddingHorizontal: 20, paddingTop: 14 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: COLORS.heading, fontSize: 25, fontFamily: FONT.extrabold },
  markAll: { color: COLORS.primary, fontSize: 13, fontFamily: FONT.bold },

  tabsRow: { flexDirection: "row", gap: 20, paddingHorizontal: 20, marginTop: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tabBtn: { paddingBottom: 10, minHeight: 36, justifyContent: "flex-start" },
  tabText: { color: COLORS.muted, fontSize: 14, fontFamily: FONT.bold },
  tabTextActive: { color: COLORS.heading },
  tabUnderline: { height: 2, backgroundColor: COLORS.primary, marginTop: 8, borderRadius: 1 },

  list: { paddingHorizontal: 20, paddingBottom: 36, paddingTop: 16 },

  group: { marginBottom: 18 },
  groupLabel: { color: COLORS.muted, fontSize: 11, fontFamily: FONT.extrabold, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 8 },

  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 13,
    marginBottom: 8,
  },
  rowUnread: { backgroundColor: COLORS.primaryTint, borderColor: COLORS.border },
  rowIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  rowBody: { flex: 1 },
  rowMessage: { color: COLORS.heading, fontSize: 13, fontFamily: FONT.regular, lineHeight: 19 },
  rowMessageUnread: { fontFamily: FONT.bold },
  rowTime: { color: COLORS.muted, fontSize: 11, fontFamily: FONT.regular, marginTop: 3 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary, marginTop: 6 },

  loadMore: { minHeight: 44, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 12, paddingVertical: 12, marginTop: 4 },
  loadMoreText: { color: COLORS.primary, fontSize: 13, fontFamily: FONT.bold },

  emptyCard: { alignItems: "center", backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 16, gap: 10, marginTop: 18, paddingHorizontal: 24, paddingVertical: 28 },
  emptyTitle: { color: COLORS.heading, fontSize: 15, fontFamily: FONT.extrabold },
  emptyBody: { color: COLORS.muted, fontSize: 13, fontFamily: FONT.regular, lineHeight: 19, textAlign: "center" },

  errorCard: { backgroundColor: COLORS.errorFill, borderColor: COLORS.errorBorder, borderWidth: 1, borderRadius: 16, marginHorizontal: 20, marginTop: 14, padding: 16 },
  errorTitle: { color: COLORS.errorText, fontSize: 15, fontFamily: FONT.extrabold },
  errorBody: { color: COLORS.errorText, fontSize: 13, fontFamily: FONT.regular, lineHeight: 19, marginTop: 6 },
  retryButton: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start", backgroundColor: COLORS.primary, borderRadius: 10, marginTop: 12, paddingHorizontal: 13, paddingVertical: 9 },
  retryText: { color: "#FFFFFF", fontSize: 12, fontFamily: FONT.extrabold },
});