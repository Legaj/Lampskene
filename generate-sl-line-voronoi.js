// Generates an approximate nearest-SL-line data file for matching questions.
// Usage:
//   node generate-sl-line-voronoi.js [cellMeters] [marginMeters]
//
// The output is sl-line-voronoi-data.js. It stores a raster/run-length
// approximation: each row run is a rectangle where the nearest SL line group is
// the same. Smaller cellMeters is more accurate and much larger.
//
// The bounding box is fixed at T-Centralen ± 35 km (70 × 70 km square).
// Adjacent row-rectangles with the same line ID and matching column spans are
// merged vertically to minimise the number of rectangles in the output, which
// reduces lag when the data is used in a mobile web-app.

const fs = require('fs');
const vm = require('vm');

const cellMeters = Math.max(5, Number(process.argv[2]) || 150);
// marginMeters argument is kept for CLI compatibility but is ignored; the bbox
// is now fixed around T-Centralen.
const inputFile = 'matching-area-data.js';
const outputFile = 'sl-line-voronoi-data.js';

const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync(inputFile, 'utf8') + '\nthis.MATCHING_AREA_DATA = MATCHING_AREA_DATA;', context);

const sourceLines = context.MATCHING_AREA_DATA['SL Transit Line'];
if (!sourceLines || !sourceLines.length) throw new Error('No SL Transit Line data found.');

// ---------------------------------------------------------------------------
// Fixed 70 × 70 km bounding box centred on T-Centralen
// ---------------------------------------------------------------------------
const T_CENTRALEN_LAT = 59.3310;
const T_CENTRALEN_LNG = 18.0686;
const HALF_SIDE_METERS = 50_000; // 50 km in each direction (extends ~15km beyond lines)

const refLat = T_CENTRALEN_LAT;
const metersPerLat = 111320;
const metersPerLng = 111320 * Math.cos(refLat * Math.PI / 180);

function toXY(lng, lat) {
  return { x: lng * metersPerLng, y: lat * metersPerLat };
}
function toLngLat(x, y) {
  return [round(x / metersPerLng), round(y / metersPerLat)];
}
function round(n) {
  return Math.round(n * 1e6) / 1e6;
}
function distSqPointSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx, qy = ay + t * dy;
  const ex = px - qx, ey = py - qy;
  return ex * ex + ey * ey;
}

const lines = sourceLines.map(line => ({
  id: line.id,
  name: line.name,
  colour: line.colour,
  segments: (line.segments || []).map(seg => seg.map(([lng, lat]) => toXY(lng, lat)))
}));

function nearestLineId(x, y) {
  let best = null, bestDist = Infinity;
  for (const line of lines) {
    for (const seg of line.segments) {
      for (let i = 0; i < seg.length - 1; i++) {
        const a = seg[i], b = seg[i + 1];
        const d = distSqPointSegment(x, y, a.x, a.y, b.x, b.y);
        if (d < bestDist) { bestDist = d; best = line.id; }
      }
    }
  }
  return best;
}

// Derive bbox from T-Centralen in meter-space
const centre = toXY(T_CENTRALEN_LNG, T_CENTRALEN_LAT);
const x0 = centre.x - HALF_SIDE_METERS;
const x1 = centre.x + HALF_SIDE_METERS;
const y0 = centre.y - HALF_SIDE_METERS;
const y1 = centre.y + HALF_SIDE_METERS;

const cols = Math.ceil((x1 - x0) / cellMeters);
const rows = Math.ceil((y1 - y0) / cellMeters);

console.log(`Bounding box: T-Centralen ± 50 km  →  ${(2*HALF_SIDE_METERS/1000).toFixed(0)} × ${(2*HALF_SIDE_METERS/1000).toFixed(0)} km`);
console.log(`Generating ${cols} × ${rows} grid (${cols * rows} cells) at ${cellMeters} m …`);

// ---------------------------------------------------------------------------
// Step 1 – rasterise: collect row-runs per line
// Each run is stored as { col0, col1, row } (col1 exclusive)
// ---------------------------------------------------------------------------

// lineRunsByLine[lineId] = array of { col0, col1, row }
const lineRunsByLine = Object.fromEntries(lines.map(line => [line.id, []]));

for (let row = 0; row < rows; row++) {
  const cy = y0 + (row + 0.5) * cellMeters;
  let runId = null, runStart = 0;
  for (let col = 0; col <= cols; col++) {
    const id = col < cols ? nearestLineId(x0 + (col + 0.5) * cellMeters, cy) : null;
    if (col === 0) { runId = id; runStart = 0; continue; }
    if (id !== runId) {
      if (runId !== null) {
        lineRunsByLine[runId].push({ col0: runStart, col1: col, row });
      }
      runId = id;
      runStart = col;
    }
  }
  if ((row + 1) % 25 === 0 || row === rows - 1) console.log(`  row ${row + 1}/${rows}`);
}

// ---------------------------------------------------------------------------
// Step 2 – vertical merging
//
// For each line, sort runs by (col0, col1, row) and greedily merge any run
// whose (col0, col1) span matches the span of the most recently open rectangle
// for that span and whose row is exactly (prevRow + 1).
//
// This reduces the rectangle count dramatically in large uniform zones.
// ---------------------------------------------------------------------------

function mergeRuns(runs) {
  if (!runs.length) return [];

  // Sort by col0, then col1, then row so identical spans are contiguous
  runs.sort((a, b) => a.col0 - b.col0 || a.col1 - b.col1 || a.row - b.row);

  // open: Map<key, { col0, col1, startRow, endRow }>
  const open = new Map();
  const closed = [];

  for (const { col0, col1, row } of runs) {
    const key = `${col0},${col1}`;
    const rect = open.get(key);
    if (rect && rect.endRow === row - 1) {
      // extend existing rectangle downward
      rect.endRow = row;
    } else {
      // close old rect for this span if any
      if (rect) closed.push(rect);
      open.set(key, { col0, col1, startRow: row, endRow: row });
    }
  }

  // close all remaining open rects
  for (const rect of open.values()) closed.push(rect);

  return closed;
}

// ---------------------------------------------------------------------------
// Step 3 – convert merged rectangles back to lng/lat pairs
// ---------------------------------------------------------------------------

function rectToLngLat({ col0, col1, startRow, endRow }) {
  const rx0 = x0 + col0 * cellMeters;
  const rx1 = x0 + col1 * cellMeters;
  const ry0 = y0 + startRow * cellMeters;
  const ry1 = y0 + (endRow + 1) * cellMeters;
  return [toLngLat(rx0, ry0), toLngLat(rx1, ry1)];
}

const data = lines.map(line => {
  const merged = mergeRuns(lineRunsByLine[line.id]);
  return {
    id: line.id,
    name: line.name,
    type: 'raster-voronoi',
    colour: line.colour,
    cellMeters,
    rects: merged.map(rectToLngLat)
  };
});

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const totalRects = data.reduce((sum, line) => sum + line.rects.length, 0);
console.log(`Rectangles after merging: ${totalRects}`);

const out = `// sl-line-voronoi-data.js\n// Generated by generate-sl-line-voronoi.js at ${cellMeters}m cells.\n// Bounding box: T-Centralen ± 35 km (70 × 70 km).\n// Each rect is [[minLng,minLat],[maxLng,maxLat]].\n\nconst SL_LINE_VORONOI_DATA = ${JSON.stringify(data)};\n`;
fs.writeFileSync(outputFile, out);
console.log(`Wrote ${outputFile}`);