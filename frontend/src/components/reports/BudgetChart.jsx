import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { BarController, BarElement, CategoryScale, Chart, Legend, LinearScale, Tooltip } from "chart.js";
import "./BudgetChart.css";

// Register only what a bar chart needs, so the bundle stays small.
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const BUDGET_COLOR = "#9b806e"; // muted taupe
const SPEND_COLOR = "#ec7a1c"; // brand orange
const OVER_COLOR = "#a23223"; // danger: spend above budget

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });

/**
 * Grouped bars: budget vs period spend, one group per project.
 * Plain Chart.js on a canvas (no wrapper library). The chart object lives in a
 * ref and is destroyed before a new one is drawn or the component goes away,
 * otherwise old charts pile up on the same canvas ("ghost charts").
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
    chartRef.current = new Chart(canvasRef.current, {
      type: "bar",
      data: {
        labels: projects.map((p) => p.name),
        datasets: [
          { label: "Budget", data: projects.map((p) => p.budget), backgroundColor: BUDGET_COLOR },
          {
            label: "Spend in period",
            data: projects.map((p) => p.periodSpend),
            backgroundColor: projects.map((p) => (p.overrun ? OVER_COLOR : SPEND_COLOR)),
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
          tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${PESO.format(item.parsed.y)}` } },
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: (value) => PESO.format(value) } },
        },
      },
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [projects]);

  const description = projects
    .map((p) => `${p.name}: budget ${PESO.format(p.budget)}, spend ${PESO.format(p.periodSpend)}${p.overrun ? " (over budget)" : ""}`)
    .join("; ");

  return (
    <div className="budget-chart">
      <canvas ref={canvasRef} role="img" aria-label={`Budget against spend. ${description}`} />
    </div>
  );
});
