export const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US");

const ACRONYMS = new Set(["gpt", "glm", "llm", "ai"]);
const stripSlug = (slug: string) => slug.replace(/^[^/]*\//, "").replace(/-\d{8}$/, "");

export type Names = Record<string, string>;

/** OpenRouter's display name for a permaslug, else formatted from the slug. Siblings whose names would collide get the release date, e.g. "(Oct 17)". */
export function displayName(slug: string, siblings: string[] = [], names: Names = {}): string {
  const name = baseName(slug, names);
  const collides = siblings.some((s) => s !== slug && baseName(s, names) === name);
  const d = collides ? slug.match(/-(\d{4})(\d{2})(\d{2})$/) : null;
  // Suffix is the model's release date, e.g. "(Oct 17)".
  return d ? `${name} (${new Date(`${d[1]}-${d[2]}-${d[3]}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })})` : name;
}

function baseName(slug: string, names: Names): string {
  return names[slug] ?? stripSlug(slug)
    .split("-")
    .map((t) => (/^v?\d/i.test(t) ? t.replace(/^V(?=\d)/, "v") : ACRONYMS.has(t) ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1)))
    .join(" ");
}

/** 59.2T, 812B, 3.4M */
export function compact(n: number): string {
  for (const [d, u] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) {
    if (Math.abs(n) >= d) return `${(n / d).toFixed(n / d >= 100 ? 0 : 1)}${u}`;
  }
  return String(Math.round(n));
}

export const title = (m: { kind: string; model_permaslug: string | null }, names?: Names) =>
  m.kind === "top5" ? "Top 5 slate" : `Growth: ${displayName(m.model_permaslug!, [], names)}`;

export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/** top5 JSON array -> "1. X · 2. Y · ..." */
export const slate = (json: string, options: string[], names?: Names) =>
  (JSON.parse(json) as string[]).map((s, i) => `${i + 1}. ${displayName(s, options, names)}`).join(" · ");

/** A resolved market's outcome: growth % or the actual top-5 slate. */
export const resolvedLabel = (m: { kind: string; resolved_value: string | null }, names?: Names, options: string[] = []) =>
  !m.resolved_value ? "n/a" : m.kind === "growth" ? `${Number(m.resolved_value).toFixed(1)}%` : slate(m.resolved_value, options, names);

/** A bet's pick: predicted % (growth) or its top-5 slate. */
export const choiceLabel = (b: { choice_text: string | null; predicted_pct: number | null }, names?: Names, options: string[] = []) =>
  b.choice_text ? slate(b.choice_text, options, names) : `${b.predicted_pct}%`;
