import { useEffect, useMemo, useRef } from "react";
import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from "chart.js";
import { SHARE_COLORS } from "./SpendShare";
import { useLocale } from "../../i18n/LocaleProvider";
import "./BudgetChart.css";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
const PESO_SHORT = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", notation: "compact", maximumFractionDigits: 1 });

/**
 * Approved spend per month of the chosen period: one bar per month, split by
 * project in the same colours as "Where this period's spend went". Hover a bar
 * for each project's amount and the month's total.
 * months: summary.months (YYYY-MM); projects / totals: their monthlySpend lists
 * line up with months.
 */
export function MonthlySpendChart({ months, projects, totals }) {
  const { t, formatDate } = useLocale();
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const labels = useMemo(
    () => months.map((key) => formatDate(`${key}-01`, { month: "short", year: "numeric" })),
    [months, formatDate]
  );

  useEffect(() => {
    chartRef.current?.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: "bar",
      data: {
        labels,
        datasets: projects.map((p, i) => ({
          label: p.name,
          data: p.monthlySpend ?? months.map(() => 0),
          backgroundColor: SHARE_COLORS[i % SHARE_COLORS.length],
          stack: "spend",
          maxBarThickness: 56,
        })),
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (item) => item.parsed.y > 0,
            callbacks: {
              label: (item) => `${item.dataset.label}: ${PESO.format(item.parsed.y)}`,
              footer: (items) => (items.length ? t("rep.monthly_total", { amount: PESO.format(totals.monthlySpend?.[items[0].dataIndex] ?? 0) }) : ""),
            },
          },
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { callback: (value) => PESO_SHORT.format(value) }, grid: { color: "#efece6" } },
        },
      },
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [labels, months, projects, totals, t]);

  const description = labels.map((label, i) => `${label}: ${PESO.format(totals.monthlySpend?.[i] ?? 0)}`).join("; ");

  return (
    <>
      {projects.length > 1 && (
        <ul className="chart-legend" aria-hidden="true">
          {projects.map((p, i) => (
            <li key={p.projectId}>
              <span className="chart-legend-swatch" style={{ background: SHARE_COLORS[i % SHARE_COLORS.length] }} />
              {p.name}
            </li>
          ))}
        </ul>
      )}
      <div className="budget-chart" style={{ height: 260 }}>
        <canvas ref={canvasRef} role="img" aria-label={t("rep.monthly_aria", { description })} />
      </div>
    </>
  );
}
