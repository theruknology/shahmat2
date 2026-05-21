import type { Puzzle, ThemeSkill, PolicyName } from "./types";
import { puzzleMu, pCorrect, PRIOR_MU } from "./skill";

// epsilon-greedy floor. WITHOUT stochasticity there are no off-policy estimates
// at all, so even the "deterministic" policies mix in a uniform floor. Every
// serve logs propensity = P(chosen | state) so target policies are estimable
// off-policy later (Part B).
export const EPSILON = 0.1;

// Softmax inverse-temperature over the policy score. Higher = greedier.
const BETA = 45;

export interface Selection {
  puzzle: Puzzle;
  propensity: number;
  candidateSetSize: number;
  policyVersion: string;
}

export type Rng = () => number;

// Deterministic seedable RNG so a session is reproducible if desired.
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleFrom(probs: number[], rng: Rng): number {
  const r = rng();
  let acc = 0;
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i];
    if (r < acc) return i;
  }
  return probs.length - 1;
}

function globalEstimate(skills: Map<string, ThemeSkill>): number {
  if (skills.size === 0) return PRIOR_MU;
  let sum = 0;
  for (const s of skills.values()) sum += s.mu;
  return sum / skills.size;
}

// Build a full probability vector over the corpus, mixing a policy-specific
// distribution `base` (must sum to 1) with a uniform epsilon floor.
function mixEpsilon(base: number[], eps: number): number[] {
  const M = base.length;
  const u = eps / M;
  return base.map((p) => (1 - eps) * p + u);
}

function softmax(scores: number[]): number[] {
  let max = -Infinity;
  for (const s of scores) if (s > max) max = s;
  let z = 0;
  const out = scores.map((s) => {
    const e = Math.exp(s - max);
    z += e;
    return e;
  });
  return out.map((e) => e / z);
}

export function select(
  policy: PolicyName,
  puzzles: Puzzle[],
  skills: Map<string, ThemeSkill>,
  rng: Rng,
): Selection {
  const M = puzzles.length;
  let base: number[];
  let version: string;

  switch (policy) {
    case "random": {
      base = new Array(M).fill(1 / M);
      version = "random@v1";
      break;
    }
    case "rating_match": {
      // Honest baseline: what every existing trainer does. Puzzles within +-100
      // of a static global estimate, uniform inside the band.
      const est = globalEstimate(skills);
      const inBand = puzzles.map((p) => Math.abs(p.rating - est) <= 100);
      const n = inBand.reduce((a, b) => a + (b ? 1 : 0), 0);
      base = inBand.map((b) => (n > 0 ? (b ? 1 / n : 0) : 1 / M));
      version = "rating_match@v1";
      break;
    }
    case "max_info": {
      // Fisher information for the Rasch model is maximised when p ~= 0.5, i.e.
      // difficulty ~= ability. Score = p(1-p) using the puzzle's theme means.
      const scores = puzzles.map((p) => {
        const { mu } = puzzleMu(skills, p.themes);
        const pc = pCorrect(mu, p.rating);
        return BETA * (pc * (1 - pc));
      });
      base = softmax(scores);
      version = "max_info@v1";
      break;
    }
  }

  const probs = mixEpsilon(base, EPSILON);
  const idx = sampleFrom(probs, rng);
  return {
    puzzle: puzzles[idx],
    propensity: probs[idx],
    candidateSetSize: M,
    policyVersion: `${version}+eps${EPSILON}`,
  };
}
