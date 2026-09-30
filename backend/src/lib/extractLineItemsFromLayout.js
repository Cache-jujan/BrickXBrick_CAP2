"use strict";

/**
 * extractLineItemsFromLayout(words)
 *
 * words: [{ text, vertices: [{x,y}x4] }]  — raw Vision API word boxes,
 * as produced by dump-vision-layout.js (index 0 / full-text blob already stripped).
 *
 * Pipeline:
 *   1. Orientation detection  — median word angle, snap to nearest 0/90/180/270°
 *   2. Rotate all word boxes by the correction angle
 *   3. Watermark rejection    — drop words still >20° off-axis after correction
 *   4. Row reconstruction     — y-proximity clustering, tolerance = 0.6 * median word height
 *   5. Column mapping         — anchor to header row word x-centers, classify by keyword
 *   6. Table-end detection    — stop after 2 consecutive rows with no qty AND no amount
 */

function centerAndSize(vertices) {
  const xs = vertices.map((v) => v.x);
  const ys = vertices.map((v) => v.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: maxX - minX,
    h: maxY - minY,
  };
}

function wordAngleDeg(vertices) {
  // top edge: vertex 0 -> vertex 1
  const [a, b] = vertices;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function snapToNearest90(angleDeg) {
  // normalize to [-180, 180)
  let a = ((angleDeg + 180) % 360 + 360) % 360 - 180;
  const candidates = [-180, -90, 0, 90, 180];
  let best = 0;
  let bestDiff = Infinity;
  for (const c of candidates) {
    const diff = Math.abs(a - c);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }
  return best === -180 ? 180 : best;
}

function rotatePoint(x, y, degrees) {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

const HEADER_KEYWORDS = {
  qty: ["qty", "quantity", "qty.", "pcs"],
  unit: ["unit", "u/m", "um", "uom"],
  article: ["article", "description", "item", "particulars", "items"],
  price: ["price", "unitprice", "rate"],
  amount: ["amount", "total", "subtotal"],
};

function classifyHeaderWord(text) {
  const t = text.toLowerCase().replace(/[^a-z]/g, "");
  for (const [col, kws] of Object.entries(HEADER_KEYWORDS)) {
    for (const kw of kws) {
      const kwNorm = kw.replace(/[^a-z]/g, "");
      if (t === kwNorm || (kwNorm.length >= 3 && t.includes(kwNorm))) {
        return col;
      }
    }
  }
  return null;
}

function extractLineItemsFromLayout(words, opts = {}) {
  const debug = !!opts.debug;
  if (!Array.isArray(words) || words.length === 0) {
    return { orientationDeg: 0, watermarkDropped: 0, headerFound: false, lineItems: [], rows: [] };
  }

  // --- Step 1: orientation detection ---
  const rawAngles = words.map((w) => wordAngleDeg(w.vertices));
  const medianAngle = median(rawAngles);
  const correction = -snapToNearest90(medianAngle); // rotate by -snap to bring text to horizontal

  // --- Step 2: rotate all word boxes ---
  const rotated = words.map((w) => {
    const rv = w.vertices.map((v) => rotatePoint(v.x, v.y, correction));
    const { cx, cy, w: ww, h: hh } = centerAndSize(rv);
    const angleAfter = wordAngleDeg(rv);
    return { text: w.text, cx, cy, w: ww, h: hh, angleAfter };
  });

  // --- Step 3: watermark / off-axis rejection ---
  const kept = [];
  let dropped = 0;
  for (const w of rotated) {
    // normalize angleAfter to [-90, 90]
    let a = w.angleAfter % 180;
    if (a > 90) a -= 180;
    if (a < -90) a += 180;
    if (Math.abs(a) > 20) {
      dropped++;
      continue;
    }
    kept.push(w);
  }

  if (kept.length === 0) {
    return { orientationDeg: -correction, watermarkDropped: dropped, headerFound: false, lineItems: [], rows: [] };
  }

  // --- Step 4: row reconstruction (y-proximity clustering) ---
  const medianHeight = median(kept.map((w) => w.h)) || 20;
  const rowTolerance = 0.6 * medianHeight;

  const sortedByY = [...kept].sort((a, b) => a.cy - b.cy);
  const rowClusters = [];
  for (const w of sortedByY) {
    let placed = false;
    for (const cluster of rowClusters) {
      if (Math.abs(cluster.avgCy - w.cy) <= rowTolerance) {
        cluster.words.push(w);
        cluster.avgCy = cluster.words.reduce((s, x) => s + x.cy, 0) / cluster.words.length;
        placed = true;
        break;
      }
    }
    if (!placed) {
      rowClusters.push({ avgCy: w.cy, words: [w] });
    }
  }
  rowClusters.sort((a, b) => a.avgCy - b.avgCy);

  const rows = rowClusters.map((c) => ({
    y: c.avgCy,
    words: c.words.sort((a, b) => a.cx - b.cx),
    text: c.words.sort((a, b) => a.cx - b.cx).map((w) => w.text).join(" "),
  }));

  // --- Step 5: locate header row + column mapping ---
  let headerRowIdx = -1;
  let columnMap = null; // { qty: x, unit: x, article: x, price: x, amount: x }

  for (let i = 0; i < rows.length; i++) {
    const found = {};
    for (const w of rows[i].words) {
      const col = classifyHeaderWord(w.text);
      if (col && !(col in found)) found[col] = w.cx;
    }
    // require at least amount + one of (article|qty|price) to call it a header
    if (found.amount !== undefined && (found.article !== undefined || found.qty !== undefined || found.price !== undefined)) {
      headerRowIdx = i;
      columnMap = found;
      break;
    }
  }

  if (headerRowIdx === -1) {
    return {
      orientationDeg: -correction,
      watermarkDropped: dropped,
      headerFound: false,
      lineItems: [],
      rows: rows.map((r) => r.text),
    };
  }

  const colEntries = Object.entries(columnMap).sort((a, b) => a[1] - b[1]);
  const colNames = colEntries.map((e) => e[0]);
  const colBoundaries = colEntries.map((e) => e[1]);

  function assignColumn(cx) {
    // nearest column anchor by x
    let best = colNames[0];
    let bestDiff = Infinity;
    for (let i = 0; i < colBoundaries.length; i++) {
      const diff = Math.abs(cx - colBoundaries[i]);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = colNames[i];
      }
    }
    return best;
  }

  // --- Step 6: table-end detection + row spacing gap check ---
  const bodyRows = rows.slice(headerRowIdx + 1);
  const rowGaps = [];
  for (let i = 1; i < bodyRows.length; i++) {
    rowGaps.push(bodyRows[i].y - bodyRows[i - 1].y);
  }
  const medianGap = median(rowGaps) || medianHeight * 1.5;

  const lineItems = [];
  let consecutiveEmpty = 0;
  let prevY = bodyRows.length ? bodyRows[0].y - medianGap : 0;

  for (const row of bodyRows) {
    const gap = row.y - prevY;
    if (gap > 2.5 * medianGap && lineItems.length > 0) {
      break; // visual gap -> tax-summary / footer block
    }

    const item = {};
    for (const w of row.words) {
      const col = assignColumn(w.cx);
      item[col] = item[col] ? `${item[col]} ${w.text}` : w.text;
    }

    const hasQty = !!item.qty;
    const hasAmount = !!item.amount;

    if (!hasQty && !hasAmount) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 2) break;
      prevY = row.y;
      continue;
    }
    consecutiveEmpty = 0;

    lineItems.push({
      qty: item.qty || null,
      unit: item.unit || null,
      description: item.article || null,
      price: item.price || null,
      amount: item.amount || null,
      rowText: row.text,
    });

    prevY = row.y;
  }

  return {
    orientationDeg: -correction,
    watermarkDropped: dropped,
    headerFound: true,
    headerRowText: rows[headerRowIdx].text,
    columnMap,
    lineItems,
    rows: rows.map((r) => r.text),
  };
}

module.exports = { extractLineItemsFromLayout, wordAngleDeg, median, snapToNearest90 };
