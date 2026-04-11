import type { ThemeSkill } from "./types";

// 1-parameter IRT (Rasch) on the rating scale. s = 173.7 makes the logistic
// match standard Elo (P = 1/(1+10^(-(mu-b)/400))). Resist adding
// discrimination/guessing params: with n=1 you cannot fit them.
export const SCALE = 173.7;

export const PRIOR_MU = 1200;
export const PRIOR_SIGMA = 350; // Glicko-style initial rating deviation

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function pCorrect(mu: number, difficulty: number): number {
  return sigmoid((mu - difficulty) / SCALE);
}

export function newSkill(theme: string): ThemeSkill {
  return { theme, mu: PRIOR_MU, sigma: PRIOR_SIGMA, nObs: 0 };
}

// Assumed-density filtering: moment-match the posterior to a Gaussian after one
// Bernoulli observation. Closed form isn't available for the logistic link, so
// integrate on a small grid around the prior mean. 41 points => microseconds.
function adfUpdate(
  mu: number,
  sigma: number,
  difficulty: number,
  correct: boolean,
): { mu: number; sigma: number } {
  const N = 41;
  const lo = mu - 4 * sigma;
  const hi = mu + 4 * sigma;
  const step = (hi - lo) / (N - 1);

  let z = 0;
  let m1 = 0;
  let m2 = 0;
  for (let i = 0; i < N; i++) {
    const theta = lo + i * step;
    const prior = Math.exp(-((theta - mu) ** 2) / (2 * sigma * sigma));
    const p = pCorrect(theta, difficulty);
    const like = correct ? p : 1 - p;
    const w = prior * like;
    z += w;
    m1 += w * theta;
    m2 += w * theta * theta;
  }
  if (z <= 0) return { mu, sigma };

  const postMu = m1 / z;
  let postVar = m2 / z - postMu * postMu;
  if (postVar < 0) postVar = 0;
  const postSigma = Math.sqrt(postVar);
  return { mu: postMu, sigma: postSigma };
}

// A multi-theme puzzle updates every tagged theme; evidence is split so a puzzle
// tagged with k themes moves each posterior by a fraction. We approximate the
// split by pulling each theme a fraction 1/k of the way toward its full update.
export function applyAttempt(
  skills: Map<string, ThemeSkill>,
  themes: string[],
  difficulty: number,
  correct: boolean,
): void {
  const k = Math.max(1, themes.length);
  for (const theme of themes) {
    const s = skills.get(theme) ?? newSkill(theme);
    const full = adfUpdate(s.mu, s.sigma, difficulty, correct);
    s.mu = s.mu + (full.mu - s.mu) / k;
    // shrink sigma partially too; full update if single-theme
    s.sigma = s.sigma + (full.sigma - s.sigma) / k;
    s.nObs += 1;
    skills.set(theme, s);
  }
}

// Estimate for a multi-theme puzzle: average the per-theme means.
export function puzzleMu(
  skills: Map<string, ThemeSkill>,
  themes: string[],
): { mu: number; sigma: number } {
  if (themes.length === 0) return { mu: PRIOR_MU, sigma: PRIOR_SIGMA };
  let mu = 0;
  let varSum = 0;
  for (const t of themes) {
    const s = skills.get(t) ?? { mu: PRIOR_MU, sigma: PRIOR_SIGMA };
    mu += s.mu;
    varSum += s.sigma * s.sigma;
  }
  const n = themes.length;
  return { mu: mu / n, sigma: Math.sqrt(varSum / (n * n)) };
}
