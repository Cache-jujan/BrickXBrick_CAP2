import { useEffect, useRef } from "react";
import {
  BarController, BarElement, CategoryScale, Chart, Filler, Legend,
  LineController, LineElement, LinearScale, PointElement, Tooltip,
} from "chart.js";

// Register only what this chart needs, so the bundle stays small.
Chart.register(BarController, BarElement, LineController, LineElement, PointElement,
  CategoryScale, LinearScale, Tooltip, Legend, Filler);

const SPEND_COLOR = "#bf4307"; // brand orange
const CUMULATIVE_COLOR = "#9e3505";
const REMAINING_COLOR = "#44443b";
const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });

// Short axis labels: 1,500,000 -> 1.5M, 250,000 -> 250K.
function compact(value) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `₱${+(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `₱${Math.round(value / 1_000)}K`;
  return `₱${value}`;
}

/**
 * Monthly approved spending (bars), running total (line) and what is left of
 * the open projects' budget (line). Plain Chart.js on a canvas. The chart is
 * destroyed before a new one is drawn or the component goes away, so old
 * charts never pile up on the same canvas.
 *
 * months: [{ label, spend, cumulative, remaining }]; remaining is null when
 * there is no budget to compare against.
 */
export function SpendChart({ months }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    chartRef.current?.destroy();
    const hasRemaining = months.some((m) => m.remaining != null);
    const datasets = [
      {
        type: "bar",
        label: "Approved spending (month)",
        data: months.map((m) => m.spend),
        backgroundColor: SPEND_COLOR,
        borderRadius: 4,
        maxBarThickness: 44,
        order: 3,
      },
      {
        type: "line",
        label: "Total approved so far",
        data: months.map((m) => m.cumulative),
        borderColor: CUMULATIVE_COLOR,
        backgroundColor: CUMULATIVE_COLOR,
        borderWidth: 2,
        pointRadius: 3,
        tension: 0.25,
        order: 2,
      },
    ];
    if (hasRemaining) {
      datasets.push({
        type: "line",
        label: "Budget left, open projects (right axis)",
        yAxisID: "y1",
        data: months.map((m) => m.remaining),
        borderColor: REMAINING_COLOR,
        backgroundColor: REMAINING_COLOR,
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 3,
        tension: 0.25,
        order: 1,
      });
    }

    chartRef.current = new Chart(canvasRef.current, {
      type: "bar",
      data: { labels: months.map((m) => m.label), datasets },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true } },
          tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${PESO.format(item.parsed.y)}` } },
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { callback: (v) => compact(v) } },
          // The budget left is far larger than a month's spending, so it gets
          // its own axis on the right; otherwise the bars shrink to nothing.
          ...(hasRemaining
            ? { y1: { position: "right", beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { callback: (v) => compact(v) } } }
            : {}),
        },
      },
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [months]);

  return (
    <div className="dash-chart" role="img" aria-label="Monthly approved spending against the budget of open projects">
      <canvas ref={canvasRef} />
    </div>
  );
}
