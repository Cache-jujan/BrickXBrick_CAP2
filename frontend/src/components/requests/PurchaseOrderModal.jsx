import { useEffect, useMemo, useRef, useState } from "react";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { extractErrorMessage } from "../../api/client";
import { getPoNumber } from "../../api/purchaseOrdersApi";
import { useAuth } from "../../context/AuthContext";
import { useLocale } from "../../i18n/LocaleProvider";
import { groupByProject } from "../../utils/openRequests";
import { buildPurchaseOrder, printHtml, renderPurchaseOrderHtml } from "../../utils/purchaseOrder";
import "./PurchaseOrderModal.css";

/**
 * "Purchase order": pick the projects, then print the list of what is still to be bought (or save it as a PDF).
 * Built in the browser from the open requests the page already has; only the PO number comes from the server.
 * `initialProjectId` ticks one project when the dialog opens from that project's own button.
 */
export function PurchaseOrderModal({ requests, initialProjectId = null, onClose }) {
  const { user } = useAuth();
  const { t, formatDate, formatNumber } = useLocale();
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  const projects = useMemo(() => groupByProject(requests.filter((r) => Number(r.remainingQuantity) > 0)), [requests]);
  const [picked, setPicked] = useState(() =>
    initialProjectId && projects.some((p) => p.projectId === initialProjectId) ? [initialProjectId] : projects.map((p) => p.projectId)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Focus the close button, close on Escape, and give focus back to the button that opened the dialog.
  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onCloseRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener && typeof opener.focus === "function" && document.contains(opener)) opener.focus();
    };
  }, []);

  const chosen = projects.filter((p) => picked.includes(p.projectId));
  const itemCount = chosen.reduce((sum, p) => sum + p.requests.length, 0);
  const countLabel = (n) => t(n === 1 ? "tb.items_one" : "tb.items_other", { count: n });

  function toggle(projectId) {
    setError("");
    setPicked((prev) => (prev.includes(projectId) ? prev.filter((id) => id !== projectId) : [...prev, projectId]));
  }

  async function create() {
    if (chosen.length === 0) {
      setError(t("po.pick_one"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const poNumber = await getPoNumber();
      const html = renderPurchaseOrderHtml(buildPurchaseOrder(chosen.flatMap((p) => p.requests)), {
        poNumber,
        dateText: formatDate(new Date(), { day: "numeric", month: "long", year: "numeric" }),
        preparedBy: user?.name ?? "",
        formatQty: (n) => (formatNumber ? formatNumber(n) : String(n)),
        labels: {
          title: t("po.doc_title"), date: t("po.doc_date"), preparedBy: t("po.doc_prepared_by"),
          project: t("po.doc_project"), item: t("po.doc_item"), quantity: t("po.doc_qty"),
          unit: t("po.doc_unit"), store: t("po.doc_store"),
        },
      });
      await printHtml(html);
      onClose();
    } catch (e) {
      setError(extractErrorMessage(e, t("po.failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" role="presentation" onClick={busy ? undefined : onClose}>
      <div className="modal po-modal" role="dialog" aria-modal="true" aria-labelledby="po-title" onClick={(e) => e.stopPropagation()}>
        <header className="po-head">
          <div>
            <h2 id="po-title" className="po-title">{t("po.sheet_title")}</h2>
            <p className="po-help">{t("po.sheet_help_web")}</p>
          </div>
          <button ref={closeRef} type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label={t("pd.close")}>×</button>
        </header>

        <ul className="po-list">
          {projects.map((project) => {
            const on = picked.includes(project.projectId);
            return (
              <li key={project.projectId}>
                <label className={`po-row${on ? " po-row-on" : ""}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(project.projectId)} />
                  <span className="po-row-name">{project.projectName}</span>
                  <span className="po-row-count">{countLabel(project.requests.length)}</span>
                </label>
              </li>
            );
          })}
        </ul>

        {error && <Banner tone="error" title={t("po.failed")}>{error}</Banner>}

        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button type="button" onClick={create} disabled={busy || chosen.length === 0}>
            {busy ? t("common.checking") : `${t("po.print")}${chosen.length > 0 ? ` (${itemCount})` : ""}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
