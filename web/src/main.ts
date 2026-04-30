import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";
import "./style.css";

import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Key } from "chessground/types";

import type { Puzzle, ThemeSkill } from "./types";
import { PuzzleSession } from "./game";
import { applyAttempt, puzzleMu, newSkill } from "./skill";

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

// ---- app state ----
let puzzles: Puzzle[] = [];
const skills = new Map<string, ThemeSkill>();
for (const t of CORE_THEMES) if (!skills.has(t)) skills.set(t, newSkill(t));

let cg: Api;
let session: PuzzleSession | null = null;
let locked = false; // true after solved/failed, until next

// ---- DOM skeleton ----
const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="statusbar">
    <span class="brand">SHAHMAT</span>
    <span class="sep">|</span>
    <span class="dim">corpus <span id="s-corpus" class="num">-</span></span>
  </div>
  <div class="grid">
    <div class="col left">
    </div>
    <div class="col center">
      <div class="board-wrap"><div id="board"></div>
      </div>
    </div>
    <div class="col right">
      <div class="panel">
        <h2>Puzzle</h2>
        <div id="p-verdict" class="verdict"></div>
      </div>
      <div class="panel">
        <h2>Controls</h2>
        <div class="controls">
          <div class="row">
            <button id="c-next">next &raquo;</button>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

const el = (id: string) => document.getElementById(id)!;

el("c-next").addEventListener("click", () => nextPuzzle());

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
  playMove(orig, dest);
}

function playMove(orig: Key, dest: Key): void {
  if (!session || locked) return;
  cg.setAutoShapes([]);

  const uci = session.buildUci(orig, dest);
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
  if (!session || locked) return;
  locked = true;
  const p = session.puzzle;

  const before = meanMu(p.themes);
  applyAttempt(skills, p.themes, p.rating, correct);
  const after = meanMu(p.themes);

  el("p-verdict").innerHTML = correct
    ? `<span class="ok">&#10003; SOLVED</span> <span class="faint">&Delta;&theta; ${fmtSigned(after - before)}</span>`
    : `<span class="bad">&#10007; ${session.expectedUci()} was best</span>`;

  renderStatus();

  // auto-advance
  window.setTimeout(() => nextPuzzle(), correct ? 650 : 2200);
}

function nextPuzzle(): void {
  cg.setAutoShapes([]);
  const pick = puzzles[Math.floor(Math.random() * puzzles.length)];
  session = new PuzzleSession(pick);
  locked = false;

  cg.set({
    fen: session.fen(),
    orientation: session.orientation,
    lastMove: undefined,
    turnColor: session.turnColor(),
  });
  refreshBoardMovable();

  el("p-verdict").textContent = "";
  renderStatus();
}

// ---- renderers ----
function fmtSigned(n: number): string {
  return (n >= 0 ? "+" : "") + n.toFixed(0);
}

function renderStatus(): void {
  el("s-corpus").textContent = String(puzzles.length);
}

// ---- boot ----
async function boot(): Promise<void> {
  const res = await fetch("./puzzles.json");
  puzzles = (await res.json()) as Puzzle[];
  renderStatus();
  nextPuzzle();
}

boot();
