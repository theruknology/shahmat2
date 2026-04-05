// Stream the Lichess puzzle CSV, sample a balanced subset across core tactical
// themes and rating bands, emit a compact JSON bundle for the static web app.
//
//   node scripts/extract_subset.mjs [perCell]
//
// Balance = (theme x rating-band) cells, each filled to `perCell` puzzles.
// Early-stops once every cell is full so we don't scan all 6M rows.

import fs from "node:fs";
import readline from "node:readline";

const CSV = "data/lichess_db_puzzle.csv";
const OUT = "web/public/puzzles.json";

// Core trainable tactical motifs. Phase/eval tags (endgame, crushing, ...) are
// kept on each puzzle for context but are NOT used for the skill model themes.
const CORE_THEMES = [
  "fork",
  "pin",
  "skewer",
  "hangingPiece",
  "discoveredAttack",
  "deflection",
  "sacrifice",
  "doubleCheck",
  "backRankMate",
  "mateIn2",
  "promotion",
  "trappedPiece",
];
const CORE = new Set(CORE_THEMES);

// Rating bands (logit-ish uniform enough on the rating scale).
const BANDS = [
  [0, 1000],
  [1000, 1300],
  [1300, 1600],
  [1600, 1900],
  [1900, 2200],
  [2200, 9999],
];
const bandIdx = (r) => BANDS.findIndex(([lo, hi]) => r >= lo && r < hi);

const perCell = parseInt(process.argv[2] ?? "55", 10);

// counts[theme][band] = n
const counts = new Map();
for (const t of CORE_THEMES) counts.set(t, new Array(BANDS.length).fill(0));
const cellsTotal = CORE_THEMES.length * BANDS.length;
let cellsFull = 0;

const picked = new Map(); // puzzle_id -> row object (dedup)

const rl = readline.createInterface({
  input: fs.createReadStream(CSV),
  crlfDelay: Infinity,
});

let header = true;
let scanned = 0;

rl.on("line", (line) => {
  if (header) {
    header = false;
    return;
  }
  scanned++;
  // CSV has no embedded commas in the fields we read; split is safe here.
  const c = line.split(",");
  if (c.length < 8) return;
  const [id, fen, moves, ratingS, , , , themesS] = c;
  const rating = parseInt(ratingS, 10);
  if (!Number.isFinite(rating)) return;
  const bi = bandIdx(rating);
  if (bi < 0) return;

  const themes = themesS.split(" ").filter(Boolean);
  const coreHit = themes.filter((t) => CORE.has(t));
  if (coreHit.length === 0) return;

  // Assign this puzzle to the least-filled core theme it satisfies, so a
  // multi-theme puzzle helps the scarcest cell.
  let target = null;
  let best = Infinity;
  for (const t of coreHit) {
    const n = counts.get(t)[bi];
    if (n < perCell && n < best) {
      best = n;
      target = t;
    }
  }
  if (target === null) return; // all its cells already full

  counts.get(target)[bi]++;
  if (counts.get(target)[bi] === perCell) {
    cellsFull++;
    if (cellsFull >= cellsTotal) rl.close();
  }

  if (!picked.has(id)) {
    picked.set(id, {
      id,
      fen,
      moves: moves.split(" "),
      rating,
      themes: themes.filter((t) => CORE.has(t)),
    });
  }
});

rl.on("close", () => {
  const rows = [...picked.values()];
  fs.writeFileSync(OUT, JSON.stringify(rows));

  // Report
  const byTheme = {};
  for (const r of rows)
    for (const t of r.themes) byTheme[t] = (byTheme[t] ?? 0) + 1;
  console.log(`scanned ${scanned} rows`);
  console.log(`picked  ${rows.length} puzzles -> ${OUT}`);
  console.log(`cells full: ${cellsFull}/${cellsTotal}`);
  console.log("per-theme (a puzzle may count for several):");
  for (const t of CORE_THEMES)
    console.log(`  ${t.padEnd(18)} ${byTheme[t] ?? 0}`);
});
