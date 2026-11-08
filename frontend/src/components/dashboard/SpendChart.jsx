import { useEffect, useRef } from "react";
import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from "chart.js";
import { useLocale } from "../../i18n/LocaleProvider";

// Register only what this chart needs, so the bundle stays small.
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const SPEND_COLOR = "#bf4307"; // brand orange
const INK = "#302f28";
const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });

// Short labels: 1,500,000 -> ₱1.5M, 250,000 -> ₱250K.
function compact(value) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `₱${+(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `₱${Math.round(value / 1_000)}K`;
  return `₱${value}`;
}

// Writes each month's amount above its bar, so it reads without hovering.
const barValues = {
  id: "spendBarValues",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.font = "600 12px Inter, -apple-system, 'Segoe UI', sans-serif";
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    chart.getDatasetMeta(0).data.forEach((bar, index) => {
      const value = chart.data.datasets[0].data[index];
      if (value > 0) ctx.fillText(compact(value), bar.x, bar.y - 4);
    });
    ctx.restore();
  },
};

/**
 * The open projects' money at a glance: one bar showing how much of their
 * budget is spent (and what is left), then approved spending per month as
 * plain bars on one scale. Hovering a month adds the running total and the
 * budget left at the end of that month.
 *
 * months: [{ label, spend, cumulative, remaining }] from buildMonthlySeries;
 * remaining is null when there is no budget to compare against.
 * budget / spent: the open projects' total budget and all their approved
 * spending (the same figures as the cards above).
 *
 * Plain Chart.js on a canvas. The chart is destroyed before a new one is drawn
 * or the component goes away, so old charts never pile up on the same canvas.
 */
export function SpendChart({ months, budget, spent }) {
  const { t } = useLocale();
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    chartRef.current?.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: "bar",
      data: {
        labels: months.map((m) => m.label),
        datasets: [
          {
            label: t("dashboard.chart_spend"),
            data: months.map((m) => m.spend),
            backgroundColor: SPEND_COLOR,
            borderRadius: 4,
            maxBarThickness: 48,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 8 } },
        // Hovering anywhere in a month's column shows it, even a month with no spending.
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              label: (item) => t("dashboard.tip_spend", { amount: PESO.format(item.parsed.y) }),
              afterLabel: (item) => {
                const m = months[item.dataIndex];
                const lines = [t("dashboard.tip_total", { amount: PESO.format(m.cumulative) })];
                if (m.remaining != null) lines.push(t("dashboard.tip_left", { amount: PESO.format(m.remaining) }));
                return lines;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          // grace leaves room above the tallest bar for its label.
          y: { beginAtZero: true, grace: "15%", ticks: { maxTicksLimit: 6, callback: (v) => compact(v) }, grid: { color: "#efece6" } },
        },
      },
      plugins: [barValues],
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [months, t]);

  const hasBudget = budget > 0;
  const pct = hasBudget ? (spent / budget) * 100 : 0;
  const over = hasBudget && spent > budget;

  return (
    <>
      {hasBudget && (
        <div className={"dash-budget" + (over ? " dash-budget-over" : "")}>
          <div className="dash-budget-text">
            <span>
              <strong>{PESO.format(spent)}</strong> {t("dashboard.budget_of", { budget: PESO.format(budget) })}
            </span>
            <span className="dash-budget-left">
              {over ? t("dashboard.budget_over", { amount: PESO.format(spent - budget) }) : t("dashboard.budget_left", { amount: PESO.format(budget - spent) })}
            </span>
          </div>
          <span
            className="dash-budget-track"
            role="img"
            aria-label={t("dashboard.budget_used_aria", { percent: pct.toFixed(1) })}
          >
            <span className="dash-budget-fill" style={{ width: `${Math.min(100, pct)}%` }} />
          </span>
        </div>
      )}
      <p className="dash-chart-title">{t("dashboard.chart_by_month")}</p>
      <div className="dash-chart" role="img" aria-label={t("dashboard.chart_aria")}>
        <canvas ref={canvasRef} />
      </div>
    </>
  );
}
