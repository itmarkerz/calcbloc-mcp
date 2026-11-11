import type { Source, TableRow, TableSection, TaxTable } from "./api.js";

export function money(n: number | null | undefined, currency: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "n/a";
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function num(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** 0.2395 → "23.95%". */
export function pct(rate: number | null | undefined, digits = 2): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "n/a";
  return `${Number((rate * 100).toFixed(digits))}%`;
}

/**
 * Referral tag for calcbloc.com page links shown in tool results, so the site's analytics can tell the visit came
 * from this server. API, download and already-tagged URLs are left as they are.
 */
const PAGE_UTM = "utm_source=calcbloc-mcp&utm_medium=app&utm_campaign=itmarkerz-oss";
const CALCBLOC_URL_RE = /https:\/\/(?:www\.)?calcbloc\.com(?:[/?#][^\s"'<>()[\]]*)?/g;

export function pageLink(url: string): string {
  const m = /^(https:\/\/(?:www\.)?calcbloc\.com)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(url);
  if (!m || /[?&]utm_source=/.test(url)) return url;
  const [, origin, path = "", query, hash] = m;
  if (/^\/api(\/|$)/.test(path) || /\.(json|csv)$/i.test(path)) return url;
  return `${origin}${path || "/"}${query ? `${query}&` : "?"}${PAGE_UTM}${hash ?? ""}`;
}

/** Tags every calcbloc.com page link in a text (trailing sentence punctuation is not part of the link). */
export function tagPageLinks(text: string): string {
  return text.replace(CALCBLOC_URL_RE, (match) => {
    const trail = /[.,;:!?]+$/.exec(match)?.[0] ?? "";
    return pageLink(match.slice(0, match.length - trail.length)) + trail;
  });
}

/** tagPageLinks() applied to every string in a structured result. */
export function tagPageLinksDeep<T>(value: T): T {
  if (typeof value === "string") return tagPageLinks(value) as T;
  if (Array.isArray(value)) return value.map((v) => tagPageLinksDeep(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, tagPageLinksDeep(v)])) as T;
  }
  return value;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Unique official sources (by URL), keeping the first title seen. */
export function uniqueSources(list: (Source | undefined)[]): Source[] {
  const seen = new Map<string, Source>();
  for (const s of list) {
    if (!s?.url || seen.has(s.url)) continue;
    seen.set(s.url, { url: s.url, ...(s.title ? { title: s.title } : {}), ...(s.retrievedAt ? { retrievedAt: s.retrievedAt } : {}) });
  }
  return [...seen.values()];
}

/** The official sources behind a set of table sections (section and row level). */
export function sectionSources(sections: TableSection[]): Source[] {
  return uniqueSources(sections.flatMap((s) => [s.source, ...s.rows.map((r) => r.source)]));
}

/** Every official source of a table: the table-level list plus section and row sources. */
export function tableSources(table: TaxTable): Source[] {
  return uniqueSources([...(table.sources ?? []), ...sectionSources(table.sections)]);
}

export function sourceLines(sources: Source[]): string[] {
  if (!sources.length) return ["- (official source list not available; see the CalcBloc page above)"];
  return sources.map((s) => `- ${s.title ? `${s.title}: ` : ""}${s.url}${s.retrievedAt ? ` (checked ${s.retrievedAt})` : ""}`);
}

function rowValue(r: TableRow, currency: string): string {
  if (r.unit === "rate" && typeof r.value === "number") return pct(r.value, 3);
  if (r.unit === "money" && typeof r.value === "number") return money(r.value, currency);
  if (typeof r.value === "number") return num(r.value);
  if (typeof r.value === "string") return r.value;
  return "";
}

export function renderRow(r: TableRow, currency: string): string {
  let text: string;
  if (r.rate !== undefined && r.rate !== null && (r.from !== undefined || r.to !== undefined)) {
    const from = r.from ?? 0;
    const range = r.to === null || r.to === undefined ? `${num(from)} and above` : `${num(from)} to ${num(r.to)}`;
    text = `${r.label ? `${r.label}: ` : ""}${range} at ${pct(r.rate, 3)}`;
  } else {
    const v = rowValue(r, currency);
    text = r.label && v ? `${r.label}: ${v}` : r.label || v;
  }
  if (r.note) text += ` (${r.note})`;
  if (r.status && r.status !== "verified") text += ` [${r.status}]`;
  return `- ${text}`;
}

export function renderSection(s: TableSection, currency: string, underReview: string[]): string[] {
  const lines = [`### ${s.title}${underReview.includes(s.id) ? " (under review)" : ""}`];
  const meta = [`section: ${s.id}`, `group: ${s.group}`];
  if (s.basis) meta.push(`basis: ${s.basis}`);
  lines.push(`(${meta.join("; ")})`);
  for (const r of s.rows) lines.push(renderRow(r, currency));
  if (s.note) lines.push(`Note: ${s.note}`);
  if (s.source?.url) lines.push(`Source: ${s.source.title ? `${s.source.title}, ` : ""}${s.source.url}${s.source.retrievedAt ? ` (checked ${s.source.retrievedAt})` : ""}`);
  return lines;
}
