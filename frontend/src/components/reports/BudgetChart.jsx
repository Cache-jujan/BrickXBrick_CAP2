import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from "chart.js";
import "./BudgetChart.css";

// Register only what a bar chart needs, so the bundle stays small.
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const USED_COLOR = "#bf4307"; // brand orange
const OVER_COLOR = "#a23223"; // danger: spend above budget
const TRACK_COLOR = "#efece6"; // the empty part of each bar (up to 100%)

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
const ROW_HEIGHT = 52;
const CHART_PADDING = 70;

// Writes "12.5%" at the end of each bar, so the numbers are readable without hovering.
const valueLabels = {
  id: "valueLabels",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(1);
    ctx.save();
    ctx.font = "600 12px Inter, -apple-system, 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";
    meta.data.forEach((bar, index) => {
      const value = chart.data.datasets[1].data[index];
      ctx.fillStyle = value > 100 ? OVER_COLOR : "#302f28";
      ctx.fillText(`${value.toFixed(value >= 10 ? 0 : 1)}%`, Math.max(bar.x, chart.scales.x.getPixelForValue(0)) + 8, bar.y);
    });
    ctx.restore();
  },
};

/**
 * One horizontal bar per project: how much of its budget has been used up to
 * the end of the period. Long project names stay readable, and a small budget
 * is not drowned out by a big one (every bar is a percentage).
 * Plain Chart.js on a canvas. The chart object lives in a ref and is destroyed
 * before a new one is drawn or the component goes away, otherwise old charts
 * pile up on the same canvas ("ghost charts").
 *
 * The parent reads the picture with ref.current.getImage() (a PNG data URL) to
 * send it to the PDF export. Animation is off so that picture is always the
 * finished chart, never a half-drawn one.
 */
export const BudgetChart = forwardRef(function BudgetChart({ projects }, ref) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useImperativeHandle(ref, () => ({
    getImage: () => (chartRef.current ? chartRef.current.toBase64Image("image/png", 1) : null),
  }));

  useEffect(() => {
    chartRef.current?.destroy();
    const used = projects.map((p) => p.cumulativeUtilizationPct ?? 0);
    const axisMax = Math.max(100, Math.ceil(Math.max(...used) / 10) * 10 + 10);
    chartRef.current = new Chart(canvasRef.current, {
      type: "bar",
      data: {
        labels: projects.map((p) => p.name),
        datasets: [
          // Background track: the full 100% of the budget.
          { label: "Budget", data: projects.map(() => 100), backgroundColor: TRACK_COLOR, barPercentage: 0.5, categoryPercentage: 0.9, grouped: false, order: 2 },
          {
            label: "Used to date",
            data: used,
            backgroundColor: used.map((value) => (value > 100 ? OVER_COLOR : USED_COLOR)),
            barPercentage: 0.5,
            categoryPercentage: 0.9,
            grouped: false,
            order: 1,
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
            filter: (item) => item.datasetIndex === 1,
            callbacks: {
              label: (item) => {
                const p = projects[item.dataIndex];
                return `${item.parsed.x.toFixed(2)}% of ${PESO.format(p.budget)} used (${PESO.format(p.cumulativeSpend)})`;
              },
            },
          },
        },
        scales: {
          x: { min: 0, max: axisMax, ticks: { callback: (value) => `${value}%` }, grid: { color: "#efece6" } },
          y: { grid: { display: false }, ticks: { autoSkip: false } },
        },
      },
      plugins: [valueLabels],
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [projects]);

  const description = projects
    .map((p) => `${p.name}: ${p.cumulativeUtilizationPct === null ? "no budget set" : `${p.cumulativeUtilizationPct.toFixed(1)}% of budget used`}${p.overrun ? " (over budget)" : ""}`)
    .join("; ");

  return (
    <div className="budget-chart" style={{ height: Math.max(150, projects.length * ROW_HEIGHT + CHART_PADDING) }}>
      <canvas ref={canvasRef} role="img" aria-label={`Budget used to date. ${description}`} />
    </div>
  );
});
