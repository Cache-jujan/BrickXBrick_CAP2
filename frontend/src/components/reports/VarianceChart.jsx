import { useEffect, useRef } from "react";
import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from "chart.js";
import { signedPct, signedPesoShort } from "../../utils/variance";
import { useLocale } from "../../i18n/LocaleProvider";
import "./BudgetChart.css";

// Register only what a bar chart needs (the same set BudgetChart registers).
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const OVER_COLOR = "#a23223"; // danger: spend above budget
const UNDER_COLOR = "#2f6f4e"; // success: still under budget
const ZERO_LINE = "#3a3631";

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
const TICK_STEP = 20;
const ROW_HEIGHT = 52;
const CHART_PADDING = 70;

// Writes "-65%" / "+25%" by each bar. For bars that go left of zero the label
// sits just right of the zero line, so it never runs into the project names.
const valueLabels = {
  id: "varianceLabels",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const zeroX = chart.scales.x.getPixelForValue(0);
    ctx.save();
    ctx.font = "600 12px Inter, -apple-system, 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";
    meta.data.forEach((bar, index) => {
      const value = chart.data.datasets[0].data[index];
      ctx.fillStyle = value > 0 ? OVER_COLOR : "#302f28";
      const text = chart.$noBudget?.[index] ? chart.$noBudgetText : signedPct(value, Math.abs(value) >= 10 ? 0 : 1);
      ctx.fillText(text, Math.max(bar.x, zeroX) + 8, bar.y);
    });
    ctx.restore();
  },
};

/**
 * One horizontal bar per project: spend to date minus budget, as a share of
 * the budget. Left of the zero line (green) is under budget, right of it (red)
 * is over. A share, not pesos, so a small budget is not drowned out by a big one.
 * projects: from GET /api/reports/summary (uses name, budget, cumulativeSpend,
 * varianceToDate, varianceToDatePct). Plain Chart.js on a canvas; the chart is
 * destroyed before a new one is drawn or the component goes away.
 */
export function VarianceChart({ projects }) {
  const { t } = useLocale();
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    chartRef.current?.destroy();
    const noBudget = projects.map((p) => !Number.isFinite(p.varianceToDatePct));
    const values = projects.map((p, i) => (noBudget[i] ? 0 : p.varianceToDatePct));
    // Spend cannot be negative, so under budget never goes past -100%.
    const axisMin = -100;
    // A multiple of the tick step, with room on the right for the label of the longest red bar.
    const axisMax = Math.max(TICK_STEP, Math.ceil((Math.max(...values) + 10) / TICK_STEP) * TICK_STEP);
    const chart = new Chart(canvasRef.current, {
      type: "bar",
      data: {
        labels: projects.map((p) => p.name),
        datasets: [
          {
            label: "Cost variance to date",
            data: values,
            backgroundColor: values.map((value) => (value > 0 ? OVER_COLOR : UNDER_COLOR)),
            barPercentage: 0.5,
            categoryPercentage: 0.9,
          },
        ],
      },
      options: {
        indexAxis: "y",
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 36 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => {
                const p = projects[item.dataIndex];
                if (noBudget[item.dataIndex]) return t("rep.tooltip_no_budget", { spend: PESO.format(p.cumulativeSpend) });
                return t("rep.tooltip_variance", { signed: signedPesoShort(p.varianceToDate), pct: signedPct(p.varianceToDatePct), spend: PESO.format(p.cumulativeSpend), budget: PESO.format(p.budget) });
              },
            },
          },
        },
        scales: {
          x: {
            min: axisMin,
            max: axisMax,
            ticks: { stepSize: TICK_STEP, callback: (value) => (value === 0 ? "0%" : signedPct(value, 0)) },
            grid: { color: (ctx) => (ctx.tick.value === 0 ? ZERO_LINE : "#efece6"), lineWidth: (ctx) => (ctx.tick.value === 0 ? 2 : 1) },
          },
          y: { grid: { display: false }, ticks: { autoSkip: false } },
        },
      },
      plugins: [valueLabels],
    });
    chart.$noBudget = noBudget;
    chart.$noBudgetText = t("rep.no_budget_short");
    chartRef.current = chart;
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [projects, t]);

  const description = projects
    .map((p) => `${p.name}: ${!Number.isFinite(p.varianceToDatePct) ? t("rep.no_budget_lower") : t("rep.var_desc", { pct: signedPct(p.varianceToDatePct), dir: p.varianceToDate > 0 ? t("rep.over_word") : t("rep.under_word") })}`)
    .join("; ");

  return (
    <div className="budget-chart" style={{ height: Math.max(150, projects.length * ROW_HEIGHT + CHART_PADDING) }}>
      <canvas ref={canvasRef} role="img" aria-label={t("rep.variance_aria", { description })} />
    </div>
  );
}
