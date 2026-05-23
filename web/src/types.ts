export interface Puzzle {
  id: string;
  fen: string; // position BEFORE opponent's move (Lichess convention)
  moves: string[]; // UCI; moves[0] is opponent's, solution starts at [1]
  rating: number;
  themes: string[]; // filtered to core trainable themes
}

// Per-theme latent ability posterior: theta_t ~ N(mu, sigma^2), on the rating scale.
export interface ThemeSkill {
  theme: string;
  mu: number;
  sigma: number;
  nObs: number;
}

export interface Attempt {
  puzzleId: string;
  ts: number;
  correct: boolean;
  msToFirstMove: number;
  msTotal: number;
  themes: string[];
  rating: number;
  policyVersion: string;
  propensity: number; // P(this puzzle | state) under the behaviour policy
  candidateSetSize: number;
}

export type PolicyName =
  | "random"
  | "rating_match"
  | "max_info";
