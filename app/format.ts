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
  m.kind === "top_model" ? "Top model by tokens" : `Growth: ${displayName(m.model_permaslug!, [], names)}`;
