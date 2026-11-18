import { useEffect, useMemo, useRef } from "react";
import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from "chart.js";
import { wrapLabel } from "../../utils/chartLabels";
import { useLocale } from "../../i18n/LocaleProvider";
import "./BudgetChart.css";

// Register only what a bar chart needs, so the bundle stays small.
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const USED_COLOR = "#bf4307"; // brand orange
const OVER_COLOR = "#a23223"; // danger: spend above budget
const DONE_COLOR = "#2f7f86"; // work done
const FULL_LINE = "#3a3631"; // the dashed 100% line
const INK = "#302f28";

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
const ROW_HEIGHT = 64;
const CHART_PADDING = 50;
const pctText = (value) => `${value.toFixed(value >= 10 ? 0 : 1)}%`;

// Writes the value at the end of each bar, so it is readable without hovering,
// and draws the dashed line where a project has spent 100% of its budget.
const decorations = {
  id: "usedDoneDecorations",
  afterDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    const x100 = scales.x.getPixelForValue(100);
    ctx.strokeStyle = FULL_LINE;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x100, chartArea.top);
    ctx.lineTo(x100, chartArea.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = "600 12px Inter, -apple-system, 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      chart.getDatasetMeta(datasetIndex).data.forEach((bar, index) => {
        const value = dataset.data[index];
        const missing = chart.$missing?.[datasetIndex]?.[index];
        ctx.fillStyle = datasetIndex === 0 && value > 100 ? OVER_COLOR : INK;
        const text = missing ? chart.$missingText[datasetIndex] : pctText(value);
        ctx.fillText(text, Math.max(bar.x, scales.x.getPixelForValue(0)) + 6, bar.y);
      });
    });
    ctx.restore();
  },
};

/**
 * Budget against actual spend, next to the work done: two bars per project,
 * how much of the budget is used up to the end of the period (orange, red past
 * 100%) and how much of the work is done (average milestone completion). A
 * dashed line marks 100% of the budget. With several projects the last row is
 * all of them together (work done weighted by budget, as the server sends it).
 *
 * The PDF draws the same chart itself, so nothing is sent from here.
 * Plain Chart.js on a canvas. The chart object lives in a ref and is destroyed
 * before a new one is drawn or the component goes away, otherwise old charts
 * pile up on the same canvas ("ghost charts").
 */
export function BudgetChart({ projects, totals }) {
  const { t } = useLocale();
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const rows = useMemo(
    () => (totals && projects.length > 1 ? [...projects, { ...totals, name: t("rep.all_projects"), all: true }] : projects),
    [projects, totals, t]
  );

  useEffect(() => {
    chartRef.current?.destroy();
    const used = rows.map((p) => p.cumulativeUtilizationPct ?? 0);
    const done = rows.map((p) => p.progressPct ?? 0);
    const axisMax = Math.max(100, Math.ceil((Math.max(...used, ...done) + 12) / 10) * 10);
    const chart = new Chart(canvasRef.current, {
      type: "bar",
      data: {
        labels: rows.map((p) => wrapLabel(p.name)),
        datasets: [
          { label: t("rep.legend_used"), data: used, backgroundColor: used.map((v) => (v > 100 ? OVER_COLOR : USED_COLOR)), barPercentage: 0.8, categoryPercentage: 0.7 },
          { label: t("rep.legend_done"), data: done, backgroundColor: DONE_COLOR, barPercentage: 0.8, categoryPercentage: 0.7 },
        ],
      },
      options: {
        indexAxis: "y",
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 8 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => rows[items[0].dataIndex].name,
              label: (item) => {
                const p = rows[item.dataIndex];
                if (item.datasetIndex === 0) {
                  if (p.cumulativeUtilizationPct === null || p.cumulativeUtilizationPct === undefined) return t("rep.no_budget");
                  return t("rep.tooltip_used", { pct: p.cumulativeUtilizationPct.toFixed(1), budget: PESO.format(p.budget), spend: PESO.format(p.cumulativeSpend) });
                }
                return p.progressPct === null || p.progressPct === undefined ? t("rep.no_milestones") : t("rep.tooltip_done", { pct: p.progressPct.toFixed(1) });
              },
            },
          },
        },
        scales: {
          x: { min: 0, max: axisMax, ticks: { stepSize: 20, callback: (value) => `${value}%` }, grid: { color: "#efece6" } },
          y: { grid: { display: false }, ticks: { autoSkip: false, color: INK, font: (ctx) => ({ weight: rows[ctx.index]?.all ? "700" : "400" }) } },
        },
      },
      plugins: [decorations],
    });
    chart.$missing = [rows.map((p) => p.cumulativeUtilizationPct === null || p.cumulativeUtilizationPct === undefined), rows.map((p) => p.progressPct === null || p.progressPct === undefined)];
    chart.$missingText = [t("rep.no_budget_short"), t("rep.no_milestones_lower")];
    chartRef.current = chart;
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [rows, t]);

  const description = rows
    .map((p) =>
      t("rep.used_done_desc", {
        name: p.name,
        used: p.cumulativeUtilizationPct === null || p.cumulativeUtilizationPct === undefined ? t("rep.no_budget_lower") : `${p.cumulativeUtilizationPct.toFixed(1)}%`,
        done: p.progressPct === null || p.progressPct === undefined ? t("rep.no_milestones_lower") : `${p.progressPct.toFixed(1)}%`,
      })
    )
    .join("; ");

  return (
    <>
      <ul className="chart-legend" aria-hidden="true">
        <li><span className="chart-legend-swatch" style={{ background: USED_COLOR }} />{t("rep.legend_used")}</li>
        <li><span className="chart-legend-swatch" style={{ background: DONE_COLOR }} />{t("rep.legend_done")}</li>
        <li><span className="chart-legend-line" />{t("rep.legend_full")}</li>
      </ul>
      <div className="budget-chart" style={{ height: Math.max(170, rows.length * ROW_HEIGHT + CHART_PADDING) }}>
        <canvas ref={canvasRef} role="img" aria-label={t("rep.used_done_aria", { description })} />
      </div>
    </>
  );
}
