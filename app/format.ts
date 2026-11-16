export const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US");

export const title = (m: { kind: string; model_permaslug: string | null }) =>
  m.kind === "top_model" ? "Top model by tokens" : `Growth: ${m.model_permaslug}`;
