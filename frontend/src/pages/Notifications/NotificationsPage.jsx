import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../../api/notificationsApi";
import { extractErrorMessage } from "../../api/client";
import { subscribeNotificationsRefresh } from "../../utils/notificationSync";
import { humanizeNotification } from "../../utils/plainLanguage";
import { metaFor, relativeTime, groupByDay, routeForNotification, notificationText } from "../../utils/notificationMeta";
import { useAuth } from "../../context/AuthContext";
import { useLocale } from "../../i18n/LocaleProvider";
import { Banner } from "../../components/ui/Banner";
import "./NotificationsPage.css";

const PAGE_SIZE = 30;

export function NotificationsPage() {
  const { user } = useAuth();
  const { t, tv, formatDate } = useLocale();
  const navigate = useNavigate();

  const [tab, setTab] = useState("Unread"); // "Unread" | "All"
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback((which) => {
    setLoading(true);
    setError("");
    listMyNotifications({ unreadOnly: which === "Unread", limit: PAGE_SIZE })
      .then((rows) => {
        setItems(rows);
        setHasMore(rows.length === PAGE_SIZE);
      })
      .catch((err) => setError(extractErrorMessage(err, t("errors.load_notifications"))))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => { load(tab); }, [tab, load]);

  // Another tab marked notifications read, or this tab was just switched back
  // to: quietly refetch the first page (no loading flash).
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeNotificationsRefresh(() => {
      listMyNotifications({ unreadOnly: tab === "Unread", limit: PAGE_SIZE })
        .then((rows) => {
          if (cancelled) return;
          setItems(rows);
          setHasMore(rows.length === PAGE_SIZE);
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [tab]);

  function loadMore() {
    const oldest = items[items.length - 1];
    if (!oldest) return;
    setLoadingMore(true);
    listMyNotifications({ unreadOnly: tab === "Unread", before: oldest.createdat, limit: PAGE_SIZE })
      .then((rows) => {
        setItems((prev) => [...prev, ...rows]);
        setHasMore(rows.length === PAGE_SIZE);
      })
      .catch((err) => setError(extractErrorMessage(err, t("errors.load_more_notifications"))))
      .finally(() => setLoadingMore(false));
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead();
    if (tab === "Unread") setItems([]);
    else setItems((prev) => prev.map((n) => ({ ...n, isread: true })));
  }

  function handleRowClick(n) {
    if (!n.isread) {
      markNotificationRead(n.notificationid).catch(() => {});
      setItems((prev) =>
        tab === "Unread"
          ? prev.filter((x) => x.notificationid !== n.notificationid)
          : prev.map((x) => (x.notificationid === n.notificationid ? { ...x, isread: true } : x))
      );
    }
    const route = routeForNotification(n, user?.role);
    if (route) navigate(route);
  }

  const unreadCount = items.filter((n) => !n.isread).length;
  const grouped = groupByDay(items);

  return (
    <div className="notifications-page">
      <div className="notifications-heading">
        <div>
          <p className="notifications-eyebrow">{t("notifications.eyebrow")}</p>
          <h1>{t("nav.notifications")}</h1>
        </div>
        {((tab === "All" && unreadCount > 0) || (tab === "Unread" && items.length > 0)) && (
          <button type="button" className="notifications-markall" onClick={handleMarkAllRead}>
            {t("notifications.mark_all_read")}
          </button>
        )}
      </div>

      <div className="notifications-tabs" role="tablist">
        {["Unread", "All"].map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={"notifications-tab" + (tab === key ? " notifications-tab-active" : "")}
            onClick={() => setTab(key)}
          >
            {key === "Unread" ? t("notifications.tab_unread") : t("common.all")}
          </button>
        ))}
      </div>

      {error && <Banner tone="error" title={error} />}

      {!error && loading && <p className="dashboard-loading">{t("common.loading")}</p>}

      {!error && !loading && items.length === 0 && (
        <Banner tone="empty" title={tab === "Unread" ? t("notifications.caught_up_title") : t("notifications.none_yet")}>
          {tab === "Unread" ? t("notifications.nothing_new") : t("notifications.empty_all")}
        </Banner>
      )}

      {!error && !loading && items.length > 0 && (
        <>
          {grouped.map(([label, rows]) => (
            <div key={label} className="notifications-group">
              <p className="notifications-group-label">{tv("notifications.group", label)}</p>
              <ul className="notifications-list">
                {rows.map((n) => {
                  const { Icon, bg, fg } = metaFor(n.type);
                  const clickable = !n.isread || routeForNotification(n, user?.role);
                  return (
                    <li
                      key={n.notificationid}
                      className={"notifications-row" + (n.isread ? "" : " notifications-row-unread") + (clickable ? "" : " notifications-row-static")}
                      onClick={clickable ? () => handleRowClick(n) : undefined}
                    >
                      <span className="notifications-row-icon" style={{ background: bg, color: fg }}>
                        <Icon />
                      </span>
                      <span className="notifications-row-body">
                        <p className="notifications-row-message">{notificationText(n, t, humanizeNotification)}</p>
                        <p className="notifications-row-time">{relativeTime(n.createdat, t, formatDate)}</p>
                      </span>
                      {!n.isread && <span className="notifications-row-dot" aria-hidden="true" />}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {hasMore && (
            <button type="button" className="notifications-loadmore" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? t("common.loading") : t("common.load_more")}
            </button>
          )}
        </>
      )}
    </div>
  );
}