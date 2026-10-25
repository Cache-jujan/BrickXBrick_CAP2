import { ArcElement, Chart, DoughnutController, Tooltip } from "chart.js";
import { useEffect, useRef } from "react";
import { useLocale } from "../../i18n/LocaleProvider";
import "./SpendShare.css";

Chart.register(ArcElement, DoughnutController, Tooltip);

// Same order as the projects, so a colour means the same project everywhere on the page.
export const SHARE_COLORS = ["#bf4307", "#3a3631", "#2f7f86", "#d9a441", "#9b6b8f"];
const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });

/**
 * Who took how much of this period's spend: a ring plus a legend.
 * projects: from GET /api/reports/summary (uses name and periodSpend).
 */
export function SpendShare({ projects, total }) {
  const { t } = useLocale();
  const canvasRef = useRef(null);
  const spenders = projects.map((p, i) => ({ name: p.name, spend: p.periodSpend, color: SHARE_COLORS[i % SHARE_COLORS.length] }));
  const hasSpend = total > 0;

  useEffect(() => {
    if (!hasSpend || !canvasRef.current) return undefined;
    const chart = new Chart(canvasRef.current, {
      type: "doughnut",
      data: {
        labels: spenders.map((s) => s.name),
        datasets: [{ data: spenders.map((s) => s.spend), backgroundColor: spenders.map((s) => s.color), borderColor: "#ffffff", borderWidth: 3 }],
      },
      options: {
        animation: false,
        cutout: "68%",
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (item) => `${PESO.format(item.parsed)} (${((item.parsed / total) * 100).toFixed(0)}%)` } },
        },
      },
    });
    return () => chart.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, total, hasSpend]);

  if (!hasSpend) {
    return <p className="spend-share-empty">{t("rep.no_spend")}</p>;
  }

  return (
    <div className="spend-share">
      <div className="spend-share-ring">
        <canvas ref={canvasRef} role="img" aria-label={t("rep.share_aria", { list: spenders.map((s) => `${s.name}: ${((s.spend / total) * 100).toFixed(0)}%`).join("; ") })} />
        <div className="spend-share-center">
          <span>{PESO.format(total)}</span>
          <small>{t("rep.this_period")}</small>
        </div>
      </div>
      <ul className="spend-share-legend">
        {spenders.map((s) => (
          <li key={s.name}>
            <span className="spend-share-dot" style={{ background: s.color }} aria-hidden="true" />
            <span className="spend-share-name">{s.name}</span>
            <span className="spend-share-pct">{((s.spend / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
