// reportPdf.js — F11 PDF export. buildReportDocDefinition is pure (it only
// builds the pdfmake document object, so tests can inspect it); renderPdf is
// the only function that touches pdfmake.
//
// Fonts: pdfmake's built-in Helvetica (a standard PDF font), so nothing has to
// be bundled into the Cloud Run image. Standard fonts have no peso sign (₱),
// so amounts print as "PHP 12,345.00".

const PdfPrinter = require("pdfmake");

const FONTS = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};

// 12345.5 -> "PHP 12,345.50", -7500 -> "-PHP 7,500.00". No locale needed.
function formatPhp(value) {
  const cents = Math.round(Number(value) * 100) + 0;
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const pesos = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}PHP ${pesos}.${String(abs % 100).padStart(2, "0")}`;
}

const formatPct = (value) => (value === null || value === undefined ? "n/a" : `${value.toFixed(2)}%`);

// Manila wall-clock for people; the exact UTC instant is what gets hashed.
function formatGeneratedAt(iso) {
  const manila = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  return `${manila.toISOString().slice(0, 16).replace("T", " ")} (Asia/Manila), UTC ${iso}`;
}

// One decimal: "104.0%", or "n/a" when there is nothing to divide by.
const formatPct1 = (value) => (value === null || value === undefined ? "n/a" : `${value.toFixed(1)}%`);

// 12345.5 -> "12,345.50" (tables say "PHP" once, in the heading).
const formatAmount = (value) => formatPhp(value).replace("PHP ", "");

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// True when the period starts after the 1st or ends before the last day of a month.
function partialMonths(from, to) {
  const lastDay = new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 0)).getUTCDate();
  return from.slice(8, 10) !== "01" || Number(to.slice(8, 10)) !== lastDay;
}
const monthLabel = (key) => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

const COLOR = {
  ink: "#302f28",
  soft: "#6b6355",
  line: "#d9d4ca",
  track: "#efece6",
  tile: "#f6f4f0",
  used: "#bf4307",
  done: "#2f7f86",
  danger: "#a23223",
  dangerBg: "#fbe4df",
  warning: "#a5751f",
  success: "#2f6f4e",
};
// Same order and colours as the Reports page, so a project keeps its colour.
const PROJECT_COLORS = ["#bf4307", "#3a3631", "#2f7f86", "#d9a441", "#9b6b8f"];

const STATUS = {
  over: { text: "Over budget", color: COLOR.danger },
  watch: { text: "Watch", color: COLOR.warning },
  ok: { text: "On track", color: COLOR.success },
};
// Older summaries (saved before health existed) only have overrun.
const statusOf = (figures) => STATUS[figures.health] || (figures.overrun ? STATUS.over : STATUS.ok);

const head = (text, alignment = "left") => ({ text, alignment, bold: true, fontSize: 7.5, color: COLOR.soft });
const right = (text, extra = {}) => ({ text, alignment: "right", noWrap: true, ...extra });
const note = (text, extra = {}) => ({ text, fontSize: 7.5, color: COLOR.soft, margin: [0, 4, 0, 0], ...extra });

// Thin lines between rows, a stronger one under the heading and above a Total.
function rowLines({ total = false } = {}) {
  return {
    hLineWidth: (i, node) => {
      if (i === 0) return 0;
      if (i === 1) return 0.8;
      if (total && i === node.table.body.length - 1) return 0.8;
      return i === node.table.body.length ? 0 : 0.4;
    },
    vLineWidth: () => 0,
    hLineColor: (i) => (i === 1 ? COLOR.soft : COLOR.line),
    paddingLeft: (i) => (i === 0 ? 0 : 4),
    paddingRight: (i, node) => (i === node.table.widths.length - 1 ? 0 : 4),
    paddingTop: () => 4,
    paddingBottom: () => 4,
  };
}

// A small coloured square and its label, for chart legends.
const legend = (items) => ({
  columns: items.map((item) => ({
    width: "auto",
    columns: [
      { width: 9, canvas: item.dashed
        ? [{ type: "line", x1: 4, y1: 0, x2: 4, y2: 8, lineWidth: 1, dash: { length: 2, space: 1.5 }, lineColor: item.color }]
        : [{ type: "rect", x: 0, y: 1, w: 7, h: 7, r: 1, color: item.color }] },
      { width: "auto", text: item.label, fontSize: 7.5, color: COLOR.soft },
    ],
    columnGap: 3,
  })),
  columnGap: 12,
  margin: [0, 0, 0, 6],
});

// Horizontal bars for one project: budget used (top) and work done (below),
// on the same 0% to axisMax% scale, with a dashed line at 100% of the budget.
const BAR_WIDTH = 250;
function usedDoneBars(figures, axisMax) {
  const x = (pct) => (Math.max(0, Math.min(pct, axisMax)) / axisMax) * BAR_WIDTH;
  const used = figures.cumulativeUtilizationPct;
  const done = figures.progressPct;
  const shapes = [
    { type: "rect", x: 0, y: 2, w: x(100), h: 7, color: COLOR.track },
    { type: "rect", x: 0, y: 12, w: x(100), h: 7, color: COLOR.track },
  ];
  if (used !== null && used !== undefined && used > 0) {
    shapes.push({ type: "rect", x: 0, y: 2, w: x(used), h: 7, color: used > 100 ? COLOR.danger : COLOR.used });
  }
  if (done !== null && done !== undefined && done > 0) {
    shapes.push({ type: "rect", x: 0, y: 12, w: x(done), h: 7, color: COLOR.done });
  }
  shapes.push({ type: "line", x1: x(100), y1: 0, x2: x(100), y2: 21, lineWidth: 0.8, dash: { length: 2, space: 1.5 }, lineColor: COLOR.ink });
  return { canvas: shapes, width: BAR_WIDTH };
}

function usedDoneValues(figures) {
  const used = figures.cumulativeUtilizationPct;
  const over = used !== null && used !== undefined && used > 100;
  return {
    stack: [
      { text: [{ text: "Used ", color: COLOR.soft }, { text: formatPct1(used), bold: true, color: over ? COLOR.danger : COLOR.ink }] },
      { text: [{ text: "Done ", color: COLOR.soft }, { text: figures.progressPct === null || figures.progressPct === undefined ? "no milestones" : formatPct1(figures.progressPct), bold: true }] },
    ],
    fontSize: 7.5,
    noWrap: true,
  };
}

// One stacked bar per month, each project in its own colour.
const MONTH_BAR_WIDTH = 360;
function monthBar(projects, index, maxTotal) {
  const shapes = [{ type: "rect", x: 0, y: 1, w: MONTH_BAR_WIDTH, h: 9, color: COLOR.track }];
  let x = 0;
  projects.forEach((project, i) => {
    const value = (project.monthlySpend && project.monthlySpend[index]) || 0;
    if (value <= 0 || maxTotal <= 0) return;
    const w = (value / maxTotal) * MONTH_BAR_WIDTH;
    shapes.push({ type: "rect", x, y: 1, w, h: 9, color: PROJECT_COLORS[i % PROJECT_COLORS.length] });
    x += w;
  });
  return { canvas: shapes, width: MONTH_BAR_WIDTH };
}

/**
 * summary:  the object from buildSummary()
 * options:  { reportId, payloadHash, anchor, generatedByName }
 *            anchor is { status: "Pending" | "Confirmed", txHash?, blockNumber? }
 *
 * The charts are drawn here as shapes (not a picture from the browser), so they
 * are sharp at any zoom, long project names wrap instead of being cut off, and
 * the PDF looks the same whatever screen it was exported from.
 */
function buildReportDocDefinition(summary, options) {
  const { reportId, payloadHash, anchor, generatedByName } = options;
  const names = summary.projects.map((p) => p.name).join(", ");
  const single = summary.projects.length === 1;
  const t = summary.totals;
  const { from, to } = summary.period;
  const watchGap = summary.watchGapPoints ?? 10;

  // --- Headline figures ------------------------------------------------------
  const left = t.netPnL;
  const leftPct = t.varianceToDatePct === null || t.varianceToDatePct === undefined ? null : -t.varianceToDatePct;
  const tile = (label, value, sub, extra = {}) => ({
    stack: [
      { text: label, fontSize: 7.5, bold: true, color: COLOR.soft },
      { text: value, fontSize: 11, bold: true, noWrap: true, margin: [0, 3, 0, 2], color: extra.color || COLOR.ink },
      { text: sub, fontSize: 7, color: COLOR.soft },
    ],
  });
  const tiles = [
    tile("Total budget", formatPhp(t.budget), single ? "Target budget of the project" : `${summary.projects.length} projects`),
    tile("Spent to date", formatPhp(t.cumulativeSpend), `${formatPhp(t.periodSpend)} in this period`),
    tile(
      "Budget left (Net P&L)",
      formatPhp(left),
      left < 0 ? `Over budget by ${formatPct1(t.varianceToDatePct)}` : leftPct === null ? "No budget set" : `${formatPct1(leftPct)} of the budget left`,
      left < 0 ? { color: COLOR.danger } : {}
    ),
    tile("Work done", t.progressPct === null || t.progressPct === undefined ? "n/a" : formatPct1(t.progressPct), `Budget used: ${formatPct1(t.cumulativeUtilizationPct)}`),
  ];
  const tilesTable = {
    table: { widths: ["*", "*", "*", "*"], body: [tiles] },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: (i) => (i === 0 || i === 4 ? 0 : 6),
      vLineColor: () => "#ffffff",
      fillColor: (row, node, column) => (column === 2 && left < 0 ? COLOR.dangerBg : COLOR.tile),
      paddingLeft: () => 8,
      paddingRight: () => 8,
      paddingTop: () => 7,
      paddingBottom: () => 7,
    },
    margin: [0, 12, 0, 0],
  };

  // --- Budget and spend by project ----------------------------------------
  const row = (name, f, bold = false) => {
    const status = statusOf(f);
    const b = bold ? { bold: true } : {};
    return [
      { text: name, ...b },
      right(formatAmount(f.budget), b),
      right(formatAmount(f.periodSpend), b),
      right(formatAmount(f.cumulativeSpend), b),
      right(formatAmount(f.netPnL), { ...b, ...(f.netPnL < 0 ? { color: COLOR.danger } : {}) }),
      right(formatPct1(f.cumulativeUtilizationPct), { ...b, ...(f.cumulativeUtilizationPct > 100 ? { color: COLOR.danger } : {}) }),
      right(f.progressPct === null || f.progressPct === undefined ? "n/a" : formatPct1(f.progressPct), b),
      { text: status.text, color: status.color, bold: true, noWrap: true },
    ];
  };
  const mainTable = {
    table: {
      headerRows: 1,
      widths: ["*", 56, 56, 56, 56, 34, 34, 50],
      body: [
        [
          head("Project"),
          head("Budget", "right"),
          head("Spent this period", "right"),
          head("Spent to date", "right"),
          head("Budget left\n(Net P&L)", "right"),
          head("Budget used", "right"),
          head("Work done", "right"),
          head("Status"),
        ],
        ...summary.projects.map((p) => row(p.name, p)),
        // One project: a Total row would only repeat the project's own row.
        ...(single ? [] : [row("Total", t, true)]),
      ],
    },
    layout: rowLines({ total: !single }),
    fontSize: 8,
  };

  // --- Budget used vs work done -------------------------------------------
  const usedValues = [...summary.projects, t].map((f) => f.cumulativeUtilizationPct ?? 0);
  const axisMax = Math.max(100, Math.ceil(Math.max(...usedValues) / 10) * 10);
  const barRows = summary.projects.map((p) => [{ text: p.name, fontSize: 8 }, usedDoneBars(p, axisMax), usedDoneValues(p)]);
  if (!single) {
    barRows.push([{ text: "All projects (weighted by budget)", fontSize: 8, bold: true }, usedDoneBars(t, axisMax), usedDoneValues(t)]);
  }
  const barsTable = {
    table: { widths: ["*", BAR_WIDTH, 70], body: barRows },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0 : !single && i === node.table.body.length - 1 ? 0.8 : 0.4),
      vLineWidth: () => 0,
      hLineColor: () => COLOR.line,
      paddingLeft: (i) => (i === 0 ? 0 : 6),
      paddingRight: (i) => (i === 2 ? 0 : 6),
      paddingTop: () => 5,
      paddingBottom: () => 5,
    },
  };
  const watching = summary.projects.filter((p) => p.health === "watch").map((p) => p.name);

  // --- Spending by month ----------------------------------------------------
  const months = summary.months || [];
  const monthTotals = t.monthlySpend || [];
  const maxMonth = Math.max(0, ...monthTotals);
  const monthRows = months.map((key, index) => [
    { text: monthLabel(key), noWrap: true },
    monthBar(summary.projects, index, maxMonth),
    right(formatAmount(monthTotals[index] || 0), monthTotals[index] > 0 ? {} : { color: COLOR.soft }),
  ]);
  const monthSection = months.length === 0
    ? []
    : [
        { text: "Spending by month", style: "section" },
        note(`Approved spend by receipt date, ${from} to ${to}, in PHP.${partialMonths(from, to) ? " A month the period only partly covers counts only the days inside it." : ""}`, { margin: [0, 0, 0, 6] }),
        ...(single ? [] : [legend(summary.projects.map((p, i) => ({ label: p.name, color: PROJECT_COLORS[i % PROJECT_COLORS.length] })))]),
        {
          table: { widths: [44, MONTH_BAR_WIDTH, "*"], body: monthRows },
          layout: {
            hLineWidth: () => 0,
            vLineWidth: () => 0,
            paddingLeft: (i) => (i === 0 ? 0 : 6),
            paddingRight: (i) => (i === 2 ? 0 : 6),
            paddingTop: () => 2,
            paddingBottom: () => 2,
          },
          fontSize: 8,
        },
      ];

  // --- BIR ------------------------------------------------------------------
  const birRows = summary.projects.map((p) => [p.name, right(formatAmount(p.birDeductibleSpend))]);

  const content = [
    {
      columns: [
        {
          stack: [
            { text: "BRICK x BRICK", fontSize: 8, bold: true, color: COLOR.used, characterSpacing: 1.5 },
            { text: "Financial Report", fontSize: 20, bold: true, margin: [0, 2, 0, 0] },
          ],
        },
        {
          width: "auto",
          alignment: "right",
          stack: [
            { text: "Reporting period", fontSize: 7.5, color: COLOR.soft },
            { text: `${from} to ${to}`, fontSize: 11, bold: true, margin: [0, 2, 0, 0] },
          ],
        },
      ],
    },
    {
      table: {
        widths: [70, "*"],
        body: [
          [{ text: single ? "Project" : "Projects", color: COLOR.soft }, names],
          [{ text: "Figures as of", color: COLOR.soft }, formatGeneratedAt(summary.generatedAt)],
          ...(generatedByName ? [[{ text: "Generated by", color: COLOR.soft }, generatedByName]] : []),
        ],
      },
      layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 4, paddingTop: () => 1, paddingBottom: () => 1 },
      fontSize: 8.5,
      margin: [0, 10, 0, 0],
    },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.8, lineColor: COLOR.line }], margin: [0, 10, 0, 0] },
    tilesTable,
    { text: single ? "Budget and spend" : "Budget and spend by project", style: "section" },
    mainTable,
    note(`Amounts in PHP. Budget left (Net P&L) = budget minus all approved spend up to ${to}. Spent this period = approved spend with receipt dates from ${from} to ${to}.`),
    { text: "Budget used vs work done", style: "section" },
    note("How much of each budget is spent, next to how much of the work is done (average milestone completion). Spending far ahead of the work is the early sign of an overrun.", { margin: [0, 0, 0, 6] }),
    legend([
      { label: "Budget used to date", color: COLOR.used },
      { label: "Work done", color: COLOR.done },
      { label: "100% of the budget", color: COLOR.ink, dashed: true },
    ]),
    barsTable,
    ...(watching.length > 0
      ? [note(`Watch: ${watching.join(", ")}. Budget used is more than ${watchGap} points ahead of work done.`, { color: COLOR.warning, bold: true })]
      : []),
    ...monthSection,
    { text: "BIR tax-deductible spend (Formal receipts only)", style: "section" },
    single
      ? {
          text: [
            { text: formatPhp(summary.projects[0].birDeductibleSpend), bold: true },
            " of this period's spend is tax-deductible (receipts classed Formal-Tax-Deductible).",
          ],
          fontSize: 9,
        }
      : {
          table: {
            headerRows: 1,
            widths: ["*", 90],
            body: [
              [head("Project"), head("Formal-Tax-Deductible (PHP)", "right")],
              ...birRows,
              [{ text: "Total", bold: true }, right(formatAmount(t.birDeductibleSpend), { bold: true })],
            ],
          },
          layout: rowLines({ total: true }),
          fontSize: 8,
        },
  ];

  const w = summary.warnings;
  if (w.pendingExpenses > 0 || w.fraudFlaggedExpenses > 0) {
    content.push(
      { text: "Integrity warnings", style: "section", color: COLOR.danger },
      {
        ul: [
          ...(w.pendingExpenses > 0
            ? [`${w.pendingExpenses} expense(s) in this period are still Pending approval and are not included in the figures.`]
            : []),
          ...(w.fraudFlaggedExpenses > 0
            ? [`${w.fraudFlaggedExpenses} expense(s) in this period carry an unresolved fraud flag.`]
            : []),
        ],
        fontSize: 8.5,
      }
    );
  }

  content.push(
    { text: "How to read this report", style: "section" },
    {
      ul: [
        "Only approved expenses count. Each expense is placed by the date printed on its receipt.",
        `Budget left (Net P&L) = budget minus all approved spend up to ${to}. Below zero means over budget. Cost variance to date is the same amount with the sign flipped.`,
        "Budget used = spend to date as a share of the budget. Work done = the average completion of the project's milestones when this report was generated.",
        `Status: Over budget when spend to date is above the budget; Watch when budget used is more than ${watchGap} points ahead of work done; otherwise On track.`,
      ],
      fontSize: 7.5,
      color: COLOR.soft,
    }
  );

  return {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 60],
    defaultStyle: { font: "Helvetica", fontSize: 9, color: COLOR.ink },
    styles: { section: { fontSize: 11, bold: true, margin: [0, 16, 0, 4] } },
    content,
    footer: (page, pages) => ({
      margin: [40, 10, 40, 0],
      fontSize: 7,
      color: COLOR.soft,
      stack: [
        { text: `Report ID: ${reportId}` },
        { text: `Report hash (SHA-256): ${payloadHash}` },
        {
          text:
            anchor.status === "Confirmed"
              ? `Blockchain anchor: Confirmed (tx ${anchor.txHash}, block ${anchor.blockNumber})`
              : "Blockchain anchor: Pending (the network was unavailable; it will be secured on retry)",
        },
        { text: `Page ${page} of ${pages}`, alignment: "right" },
      ],
    }),
  };
}

// Document definition -> Buffer.
function renderPdf(docDefinition) {
  return new Promise((resolve, reject) => {
    const doc = new PdfPrinter(FONTS).createPdfKitDocument(docDefinition);
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

module.exports = { buildReportDocDefinition, renderPdf, formatPhp, formatPct, formatPct1, formatGeneratedAt };
