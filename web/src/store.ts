import type { Attempt, ThemeSkill } from "./types";

// localStorage is enough: skills are ~12 rows, attempts a few thousand small
// objects. The propensity log lives here and exports to JSON for Part B (OPE).
const K_SKILLS = "shahmat.skills.v1";
const K_ATTEMPTS = "shahmat.attempts.v1";

export function loadSkills(): Map<string, ThemeSkill> {
  const raw = localStorage.getItem(K_SKILLS);
  const m = new Map<string, ThemeSkill>();
  if (!raw) return m;
  try {
    const arr = JSON.parse(raw) as ThemeSkill[];
    for (const s of arr) m.set(s.theme, s);
  } catch {
    /* corrupt store: start fresh */
  }
  return m;
}

export function saveSkills(skills: Map<string, ThemeSkill>): void {
  localStorage.setItem(K_SKILLS, JSON.stringify([...skills.values()]));
}

export function loadAttempts(): Attempt[] {
  const raw = localStorage.getItem(K_ATTEMPTS);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Attempt[];
  } catch {
    return [];
  }
}

export function appendAttempt(a: Attempt): void {
  const all = loadAttempts();
  all.push(a);
  localStorage.setItem(K_ATTEMPTS, JSON.stringify(all));
}

export function resetAll(): void {
  localStorage.removeItem(K_SKILLS);
  localStorage.removeItem(K_ATTEMPTS);
}

// Export the full propensity log for off-policy evaluation in Part B.
export function exportAttempts(): void {
  const data = JSON.stringify(loadAttempts(), null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `shahmat_attempts_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
