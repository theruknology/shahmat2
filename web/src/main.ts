import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";
import "./style.css";

import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Key } from "chessground/types";

import type { Puzzle, PolicyName, Attempt } from "./types";
import { PuzzleSession } from "./game";
import { select, mulberry32, type Selection } from "./policy";
import { applyAttempt, puzzleMu, pCorrect, newSkill } from "./skill";
import {
  loadSkills,
  saveSkills,
  loadAttempts,
  appendAttempt,
  exportAttempts,
  resetAll,
} from "./store";

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

const POLICIES: PolicyName[] = [
  "thompson",
  "max_info",
  "rating_match",
  "random",
];

// ---- app state ----
let puzzles: Puzzle[] = [];
const skills = loadSkills();
for (const t of CORE_THEMES) if (!skills.has(t)) skills.set(t, newSkill(t));

let policy: PolicyName = "thompson";
const rng = mulberry32((Date.now() & 0xffffffff) >>> 0);

let cg: Api;
let session: PuzzleSession | null = null;
let selection: Selection | null = null;
let startTs = 0;
let firstMoveTs = 0;
let locked = false; // true after solved/failed, until next
let advanceTimer: number | undefined;
const sessionStart = Date.now();

const sess = { served: 0, solved: 0, times: [] as number[], dTheta: 0 };

// ---- DOM skeleton ----
const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="statusbar">
    <span class="brand">SHAHMAT</span>
    <span class="sep">|</span>
    <span id="s-clock" class="num dim">00:00</span>
    <span class="sep">|</span>
    <span>policy=<span id="s-policy" class="hot">thompson</span></span>
    <span class="sep">|</span>
    <span>served <span id="s-served" class="num">0</span></span>
    <span>solved <span id="s-acc" class="num">0%</span></span>
    <span class="sep">|</span>
    <span class="dim">corpus <span id="s-corpus" class="num">-</span></span>
    <span class="sep">|</span>
    <span class="dim">compute<span id="s-heart" class="hot blink"> #</span></span>
  </div>
  <div class="grid">
    <div class="col left">
      <div class="panel grow">
        <h2><span>Theme &theta;</span><span class="faint">mu &plusmn;sd</span></h2>
        <div id="p-themes"></div>
      </div>
      <div class="panel">
        <h2>Session</h2>
        <div id="p-session"></div>
      </div>
    </div>
    <div class="col center">
      <div class="board-wrap"><div id="board"></div>
        <div id="promo" class="promo" hidden></div>
      </div>
    </div>
    <div class="col right">
      <div class="panel">
        <h2>Puzzle / Model</h2>
        <div id="p-puzzle"></div>
        <div id="p-verdict" class="verdict"></div>
      </div>
      <div class="panel grow">
        <h2>Attempt Log</h2>
        <div id="p-log"></div>
      </div>
      <div class="panel">
        <h2>Controls</h2>
        <div class="controls">
          <div class="row">
            <select id="c-policy"></select>
            <button id="c-next" title="n">next &raquo;</button>
          </div>
          <div class="row">
            <button id="c-hint" title="h">hint</button>
            <button id="c-flip" title="f">flip</button>
          </div>
          <div class="row">
            <button id="c-export">export log</button>
            <button id="c-reset">reset</button>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

const el = (id: string) => document.getElementById(id)!;

// policy selector
const sel = el("c-policy") as HTMLSelectElement;
for (const p of POLICIES) {
  const o = document.createElement("option");
  o.value = p;
  o.textContent = p;
  sel.appendChild(o);
}
sel.value = policy;
sel.addEventListener("change", () => {
  policy = sel.value as PolicyName;
  el("s-policy").textContent = policy;
});

el("c-next").addEventListener("click", () => nextPuzzle());
el("c-hint").addEventListener("click", () => showHint());
el("c-flip").addEventListener("click", () => cg.toggleOrientation());
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return;
  if (e.key === "n") nextPuzzle();
  else if (e.key === "h") showHint();
  else if (e.key === "f") cg.toggleOrientation();
});

function showHint(): void {
  if (!session || locked) return;
  const sq = session.hintSquare() as Key;
  cg.setAutoShapes([{ orig: sq, brush: "green" }]);
}
el("c-export").addEventListener("click", () => exportAttempts());
el("c-reset").addEventListener("click", () => {
  if (!confirm("Erase all skill posteriors and the attempt log?")) return;
  resetAll();
  location.reload();
});

// ---- board ----
cg = Chessground(el("board"), {
  coordinates: true,
  animation: { enabled: true, duration: 180 },
  movable: { free: false, color: undefined, dests: new Map() },
  draggable: { showGhost: true },
  highlight: { lastMove: true, check: true },
});

function refreshBoardMovable(): void {
  if (!session) return;
  const color = session.turnColor();
  cg.set({
    turnColor: color,
    movable: {
      free: false,
      color,
      dests: session.dests() as Map<Key, Key[]>,
      events: { after: onUserMove },
    },
  });
}

function onUserMove(orig: Key, dest: Key): void {
  if (!session || locked) return;
  if (session.needsPromotion(orig, dest)) {
    askPromotion(session.turnColor(), (piece) => playMove(orig, dest, piece));
    return;
  }
  playMove(orig, dest);
}

// Small overlay letting the user pick the promotion piece (allows underpromotion).
function askPromotion(color: "white" | "black", done: (p: string) => void): void {
  const box = el("promo");
  const glyph: Record<string, string> =
    color === "white"
      ? { q: "\u2655", r: "\u2656", b: "\u2657", n: "\u2658" }
      : { q: "\u265B", r: "\u265C", b: "\u265D", n: "\u265E" };
  box.innerHTML = Object.keys(glyph)
    .map((p) => `<button data-p="${p}">${glyph[p]}</button>`)
    .join("");
  box.hidden = false;
  box.onclick = (e) => {
    const p = (e.target as HTMLElement).dataset?.p;
    if (!p) return;
    box.hidden = true;
    done(p);
  };
}

function playMove(orig: Key, dest: Key, promotion = "q"): void {
  if (!session || locked) return;
  cg.setAutoShapes([]);
  if (firstMoveTs === 0) firstMoveTs = Date.now();

  const uci = session.buildUci(orig, dest, promotion);
  const res = session.userMove(uci);

  if (!res.correct) {
    finishPuzzle(false);
    // snap board back and show the best move as an arrow
    cg.set({ fen: session.fen(), movable: { color: undefined } });
    const best = session.expectedUci();
    cg.setAutoShapes([
      { orig: best.slice(0, 2) as Key, dest: best.slice(2, 4) as Key, brush: "green" },
    ]);
    return;
  }

  if (res.solved) {
    cg.set({ fen: session.fen() });
    finishPuzzle(true);
    return;
  }

  // correct but more to go: play opponent reply, keep going
  const reply = res.opponentReply!;
  cg.set({
    fen: session.fen(),
    lastMove: [reply.slice(0, 2), reply.slice(2, 4)] as Key[],
  });
  refreshBoardMovable();
}

function meanMu(themes: string[]): number {
  return puzzleMu(skills, themes).mu;
}

function finishPuzzle(correct: boolean): void {
  if (!session || !selection || locked) return;
  locked = true;
  const now = Date.now();
  const p = session.puzzle;

  const before = meanMu(p.themes);
  applyAttempt(skills, p.themes, p.rating, correct);
  const after = meanMu(p.themes);
  saveSkills(skills);

  const attempt: Attempt = {
    puzzleId: p.id,
    ts: now,
    correct,
    msToFirstMove: firstMoveTs ? firstMoveTs - startTs : -1,
    msTotal: now - startTs,
    themes: p.themes,
    rating: p.rating,
    policyVersion: selection.policyVersion,
    propensity: selection.propensity,
    candidateSetSize: selection.candidateSetSize,
  };
  appendAttempt(attempt);

  sess.served++;
  if (correct) sess.solved++;
  sess.times.push(now - startTs);
  sess.dTheta += after - before;

  el("p-verdict").innerHTML = correct
    ? `<span class="ok">&#10003; SOLVED</span> <span class="faint">&Delta;&theta; ${fmtSigned(after - before)}</span>`
    : `<span class="bad">&#10007; ${session.expectedUci()} was best</span>`;

  renderStatus();
  renderThemes();
  renderSession();
  renderLog();

  // auto-advance (cancelled if the user skips manually)
  advanceTimer = window.setTimeout(() => nextPuzzle(), correct ? 650 : 2200);
}

function nextPuzzle(): void {
  clearTimeout(advanceTimer);
  el("promo").hidden = true;
  cg.setAutoShapes([]);
  selection = select(policy, puzzles, skills, rng);
  session = new PuzzleSession(selection.puzzle);
  startTs = Date.now();
  firstMoveTs = 0;
  locked = false;

  cg.set({
    fen: session.fen(),
    orientation: session.orientation,
    lastMove: undefined,
    turnColor: session.turnColor(),
  });
  refreshBoardMovable();

  el("p-verdict").textContent = "";
  renderPuzzle();
  renderStatus();
}

// ---- renderers ----
function fmt(n: number, d = 0): string {
  return n.toFixed(d);
}
function fmtSigned(n: number): string {
  return (n >= 0 ? "+" : "") + n.toFixed(0);
}

function renderStatus(): void {
  el("s-policy").textContent = policy;
  el("s-served").textContent = String(sess.served);
  const acc = sess.served ? Math.round((100 * sess.solved) / sess.served) : 0;
  el("s-acc").textContent = `${acc}%`;
  el("s-corpus").textContent = String(puzzles.length);
}

function renderThemes(): void {
  const rows = CORE_THEMES.map((t) => {
    const s = skills.get(t)!;
    const conf = Math.max(0, Math.min(1, 1 - s.sigma / 350));
    const cells = Math.round(conf * 5);
    const bar = Array.from({ length: 5 }, (_, i) =>
      i < cells ? `<span class="cell on"></span>` : `<span class="cell"></span>`,
    ).join("");
    const overall = meanAll();
    const weak = s.mu < overall - 40;
    return `<div class="theme-row ${weak ? "weak" : ""}">
      <span class="tname">${t}</span>
      <span class="tmu num">${fmt(s.mu)}</span>
      <span class="bar" title="sd ${fmt(s.sigma)}">${bar}</span>
    </div>`;
  });
  el("p-themes").innerHTML = rows.join("");
}

function meanAll(): number {
  let sum = 0;
  for (const t of CORE_THEMES) sum += skills.get(t)!.mu;
  return sum / CORE_THEMES.length;
}

function renderSession(): void {
  const acc = sess.served ? Math.round((100 * sess.solved) / sess.served) : 0;
  const med = median(sess.times);
  el("p-session").innerHTML = `
    <div class="kv"><span class="k">solved</span><span class="num">${sess.solved}/${sess.served} ${acc}%</span></div>
    <div class="kv"><span class="k">median time</span><span class="num">${med ? (med / 1000).toFixed(1) : "-"}s</span></div>
    <div class="kv"><span class="k">&Delta;&theta; session</span><span class="num ${sess.dTheta >= 0 ? "ok" : "bad"}">${fmtSigned(sess.dTheta)}</span></div>
    <div class="kv"><span class="k">mean &theta;</span><span class="num">${fmt(meanAll())}</span></div>
  `;
}

function renderPuzzle(): void {
  if (!session || !selection) return;
  const p = session.puzzle;
  const { mu, sigma } = puzzleMu(skills, p.themes);
  const pc = pCorrect(mu, p.rating);
  el("p-puzzle").innerHTML = `
    <div class="kv"><span class="k">id</span><span class="num">${p.id}</span></div>
    <div class="kv"><span class="k">rating b_p</span><span class="num">${p.rating}</span></div>
    <div class="kv"><span class="k">themes</span><span>${p.themes.join(" ")}</span></div>
    <div class="kv"><span class="k">your &theta;</span><span class="num">${fmt(mu)} &plusmn;${fmt(sigma)}</span></div>
    <div class="kv"><span class="k">P(solve)</span><span class="num hot">${(pc * 100).toFixed(0)}%</span></div>
    <div class="kv"><span class="k">propensity</span><span class="num faint">${selection.propensity.toExponential(2)}</span></div>
    <div class="kv"><span class="k">to move</span><span>${session.orientation}</span></div>
  `;
}

function renderLog(): void {
  const all = loadAttempts();
  const recent = all.slice(-14).reverse();
  el("p-log").innerHTML = recent
    .map((a) => {
      const t = a.themes[0] ?? "-";
      const secs = a.msTotal > 0 ? (a.msTotal / 1000).toFixed(1) : "-";
      return `<div class="log-row">
        <span class="mark ${a.correct ? "ok" : "bad"}">${a.correct ? "&#10003;" : "&#10007;"}</span>
        <span class="num">${a.rating}</span>
        <span class="num dim">${secs}s</span>
        <span class="dim">${t}</span>
      </div>`;
    })
    .join("");
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// clock + heartbeat
let heart = 0;
setInterval(() => {
  const secs = Math.floor((Date.now() - sessionStart) / 1000);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  el("s-clock").textContent = `${mm}:${ss}`;
  heart = (heart + 1) % 4;
  el("s-heart").textContent = " " + "#*+.".charAt(heart);
}, 1000);

// ---- boot ----
async function boot(): Promise<void> {
  const res = await fetch("./puzzles.json");
  puzzles = (await res.json()) as Puzzle[];
  renderStatus();
  renderThemes();
  renderSession();
  renderLog();
  nextPuzzle();
}

boot();
