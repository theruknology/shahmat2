import { Chess } from "chess.js";
import type { Puzzle } from "./types";

export interface Uci {
  from: string;
  to: string;
  promotion?: string;
}

export function parseUci(uci: string): Uci {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci.slice(4) : undefined,
  };
}

// Lichess convention: fen is the position BEFORE the opponent's move. moves[0]
// is the opponent's move (auto-played); the solution is moves[1], moves[3], ...
// with the opponent's replies at even indices in between.
export class PuzzleSession {
  private chess: Chess;
  private idx = 0; // index into puzzle.moves of the NEXT move expected/played
  readonly orientation: "white" | "black";

  constructor(readonly puzzle: Puzzle) {
    this.chess = new Chess(puzzle.fen);
    // Play the opponent's setup move.
    this.applyUci(puzzle.moves[0]);
    this.idx = 1;
    // The solver is the side to move now.
    this.orientation = this.chess.turn() === "w" ? "white" : "black";
  }

  fen(): string {
    return this.chess.fen();
  }

  turnColor(): "white" | "black" {
    return this.chess.turn() === "w" ? "white" : "black";
  }

  // Legal destination map for chessground (from-square -> reachable squares).
  dests(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const m of this.chess.moves({ verbose: true })) {
      const arr = map.get(m.from) ?? [];
      arr.push(m.to);
      map.set(m.from, arr);
    }
    return map;
  }

  // Turn a chessground (orig,dest) drag into a UCI string, auto-queening.
  buildUci(from: string, to: string): string {
    const promo = this.chess
      .moves({ verbose: true })
      .some((m) => m.from === from && m.to === to && m.promotion);
    return from + to + (promo ? "q" : "");
  }

  // Square the solver should move from next (for hints).
  hintSquare(): string {
    return this.puzzle.moves[this.idx].slice(0, 2);
  }

  private applyUci(uci: string): void {
    const u = parseUci(uci);
    this.chess.move({ from: u.from, to: u.to, promotion: u.promotion });
  }

  isSolved(): boolean {
    return this.idx >= this.puzzle.moves.length;
  }

  expectedUci(): string {
    return this.puzzle.moves[this.idx];
  }

  // User attempts a move. Returns whether it matched the solution, whether the
  // puzzle is now solved, and the opponent's auto-reply (if any) to animate.
  userMove(uci: string): {
    correct: boolean;
    solved: boolean;
    opponentReply?: string;
  } {
    const expected = this.puzzle.moves[this.idx];
    if (uci !== expected) {
      return { correct: false, solved: false };
    }

    this.applyUci(uci);
    this.idx++;

    if (this.isSolved()) return { correct: true, solved: true };

    // Play opponent reply automatically.
    const reply = this.puzzle.moves[this.idx];
    this.applyUci(reply);
    this.idx++;

    return {
      correct: true,
      solved: this.isSolved(),
      opponentReply: reply,
    };
  }
}
