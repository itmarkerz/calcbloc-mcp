import type { CountryInfo, CountryParam, QueryValue } from "./api.js";
import { COVERAGE } from "./coverage.generated.js";

/** Bad input the assistant can correct (returned as a tool error with guidance, never sent to the API). */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

export type CalcKind = "net-salary" | "employer-cost";
/** API 1.8+ endpoints with their own tools (calculate_supplemental_withholding, calculate_equity_tax). */
export type ExtraKind = "supplemental-withholding" | "equity-tax";
export type ToolKind = CalcKind | ExtraKind;

/** How each kind is named in messages ("… needs a region", "… is not available for …"). */
const KIND_NAME: Record<ToolKind, string> = {
  "net-salary": "take-home pay",
  "employer-cost": "employer cost",
  "supplemental-withholding": "supplemental withholding",
  "equity-tax": "equity tax",
};

/** The parameter list of an endpoint for a country (equity tax sits outside `endpoints` in /countries). */
export function endpointParams(country: CountryInfo, kind: ToolKind): CountryParam[] | undefined {
  if (kind === "equity-tax") return country.equity_tax?.parameters;
  return country.endpoints[kind]?.parameters;
}

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_.]+/g, "-");

/** Common ways to name a country; only used when the target code is in the live country list. */
const COUNTRY_ALIASES: Record<string, string> = {
  gb: "uk",
  gbr: "uk",
  "united-kingdom": "uk",
  "great-britain": "uk",
  britain: "uk",
  england: "uk",
  scotland: "uk",
  wales: "uk",
  "northern-ireland": "uk",
  usa: "us",
  "united-states": "us",
  "united-states-of-america": "us",
  america: "us",
  nz: "new-zealand",
  ae: "uae",
  "united-arab-emirates": "uae",
  emirates: "uae",
  au: "australia",
  in: "india",
  sg: "singapore",
  ie: "ireland",
  de: "germany",
  deutschland: "germany",
  fr: "france",
  nl: "netherlands",
  holland: "netherlands",
  "the-netherlands": "netherlands",
  es: "spain",
  espana: "spain",
  it: "italy",
  pt: "portugal",
  ch: "switzerland",
  at: "austria",
  se: "sweden",
  dk: "denmark",
  no: "norway",
  fi: "finland",
  pl: "poland",
  cz: "czechia",
  "czech-republic": "czechia",
  lu: "luxembourg",
  be: "belgium",
  gr: "greece",
  hu: "hungary",
  ro: "romania",
  sk: "slovakia",
  si: "slovenia",
  lv: "latvia",
  latvija: "latvia",
  hr: "croatia",
  hrvatska: "croatia",
  ee: "estonia",
  eesti: "estonia",
  bg: "bulgaria",
  lt: "lithuania",
  lietuva: "lithuania",
  mt: "malta",
  cy: "cyprus",
  is: "iceland",
  ua: "ukraine",
  ukraina: "ukraine",
  "україна": "ukraine",
  li: "liechtenstein",
  rs: "serbia",
  srbija: "serbia",
  "србија": "serbia",
  tr: "turkey",
  turkiye: "turkey",
};
// Keys go through the same normalisation as the input (Україна loses the diaeresis on ї, for example).
const ALIASES: Record<string, string> = Object.fromEntries(Object.entries(COUNTRY_ALIASES).map(([k, v]) => [norm(k), v]));

/** The short code shown to people and in examples (API 1.7 short_code; the generated map for older or offline data). */
export function shortCodeOf(c: CountryInfo): string {
  return c.short_code ?? (COVERAGE.shortCodes as Record<string, string>)[c.code] ?? c.code;
}

export function countryList(countries: CountryInfo[]): string {
  return countries.map((c) => `${shortCodeOf(c)} (${c.name})`).join(", ");
}

export function resolveCountry(countries: CountryInfo[], input: string): CountryInfo {
  const n = norm(input);
  const direct = countries.find((c) => c.code === n || norm(c.name) === n || norm(shortCodeOf(c)) === n || (c.iso_code && norm(c.iso_code) === n));
  if (direct) return direct;
  const alias = ALIASES[n];
  const viaAlias = alias ? countries.find((c) => c.code === alias) : undefined;
  if (viaAlias) return viaAlias;
  throw new ToolInputError(`CalcBloc does not cover "${input}". Countries available: ${countryList(countries)}.`);
}

/** ISO 3166-1 alpha-2 in lower case (the UK is gb), as /tax-treaties takes and returns countries. */
export function isoCodeOf(c: CountryInfo): string {
  const iso = c.iso_code?.trim().toLowerCase();
  if (iso && /^[a-z]{2}$/.test(iso)) return iso;
  const short = shortCodeOf(c).toLowerCase();
  return short === "uk" ? "gb" : short;
}

/** The country with this ISO 3166-1 alpha-2 code (gb finds the UK), if listed. */
export function countryByIso(countries: CountryInfo[], iso: string): CountryInfo | undefined {
  const k = iso.trim().toLowerCase();
  return countries.find((c) => isoCodeOf(c) === k);
}

/**
 * The partner of a treaty lookup. Resolved like a country argument, but an unknown name gets a short message rather
 * than the whole country list: a treaty partner need not be a country CalcBloc has tax tables for.
 */
export function resolvePartner(countries: CountryInfo[], input: string): CountryInfo {
  try {
    return resolveCountry(countries, input);
  } catch (e) {
    if (!(e instanceof ToolInputError)) throw e;
    throw new ToolInputError(`Unknown partner country "${input.slice(0, 60)}". Use an ISO 3166-1 alpha-2 code (us, gb, sg) or the English name ("United States").`);
  }
}

/** Tax years are written like 2026 or 2026-27; accept 2026/27 too. */
export function normalizeYear(year: string | undefined): string {
  const y = (year ?? "").trim().toLowerCase().replace("/", "-");
  return y || "latest";
}

/** Calculations run on the current tax year only; earlier years exist as tax tables. */
export function resolveCalcYear(country: CountryInfo, year: string | undefined): string {
  const y = normalizeYear(year);
  if (y === "latest" || y === country.current_year) return country.current_year;
  const tables = country.endpoints["tax-tables"];
  if (country.years_available.includes(y))
    throw new ToolInputError(
      `Calculations for ${country.name} use the current tax year (${country.current_year}) only. The ${y} rates are available as tax tables: call get_tax_tables with year "${y}" (page: ${tables.pageUrl.replace(country.current_year, y)}).`,
    );
  throw new ToolInputError(`${country.name} tax year "${year}" is not available. Years: ${country.years_available.join(", ")} (calculations: ${country.current_year}).`);
}

export function resolveTableYear(country: CountryInfo, year: string | undefined): string {
  const y = normalizeYear(year);
  if (y === "latest") return country.current_year;
  if (country.years_available.includes(y)) return y;
  throw new ToolInputError(`No ${country.name} tax tables for "${year}". Years available: ${country.years_available.join(", ")}.`);
}

export function calcEndpoint(country: CountryInfo, kind: CalcKind) {
  return country.endpoints[kind];
}

const CALC_LABEL: Record<CalcKind, string> = { "net-salary": "Take-home pay calculation", "employer-cost": "Employer cost calculation" };

/** Throws the "not available yet" message (with the tax-table link) for countries without a calculation engine. */
export function requireCalc(country: CountryInfo, kind: CalcKind) {
  const ep = country.endpoints[kind];
  if (ep) return ep;
  const t = country.endpoints["tax-tables"];
  const others = kind === "employer-cost" && country.endpoints["net-salary"] ? " Take-home pay (calculate_take_home_pay) is available for it." : "";
  throw new ToolInputError(
    `${CALC_LABEL[kind]} is not available for ${country.name} yet.${others} Its official ${country.current_year} tax tables are available: call get_tax_tables with country "${country.code}", or see ${t.pageUrl}.`,
  );
}

/** API 1.8+: supplemental withholding and equity tax, by country. */
export const supportsExtra = (country: CountryInfo, kind: ExtraKind): boolean =>
  kind === "equity-tax" ? !!country.equity_tax : !!country.endpoints["supplemental-withholding"];

const EXTRA_LABEL: Record<ExtraKind, string> = { "supplemental-withholding": "Supplemental withholding", "equity-tax": "Equity tax" };

/**
 * Throws a message naming the countries that do have supplemental withholding / equity tax (from /countries), with the
 * tax-table link for the one asked about. Against an API older than 1.8 (no country has it) it says the API lacks it.
 */
export function requireExtra(countries: CountryInfo[], country: CountryInfo, kind: ExtraKind): CountryParam[] {
  const params = endpointParams(country, kind);
  if (params) return params;
  const supported = countries.filter((c) => supportsExtra(c, kind));
  const t = country.endpoints["tax-tables"];
  if (!supported.length)
    throw new ToolInputError(
      `${EXTRA_LABEL[kind]} is not offered by the CalcBloc API in use (it needs API 1.8 or later). ${country.name}'s official ${country.current_year} tax tables are available: call get_tax_tables, or see ${t.pageUrl}.`,
    );
  const takeHome = country.endpoints["net-salary"] ? " Take-home pay (calculate_take_home_pay) is available for it." : "";
  throw new ToolInputError(
    `${EXTRA_LABEL[kind]} is not available for ${country.name} yet. Countries with ${KIND_NAME[kind]}: ${countryList(supported)}.${takeHome} ${country.name}'s official ${country.current_year} tax tables: call get_tax_tables with country "${shortCodeOf(country)}", or see ${t.pageUrl}.`,
  );
}

function matchRegionValue(input: string, values: string[], names: { code: string; name: string }[], aliases: Record<string, string> = {}): string | undefined {
  const n = norm(input);
  const byValue = values.find((v) => norm(v) === n);
  if (byValue) return byValue;
  const named = names.find((r) => norm(r.name) === n || norm(r.code) === n);
  if (named && values.includes(named.code)) return named.code;
  const alias = aliases[n.replace(/-/g, "_")];
  if (alias && values.includes(alias)) return alias;
  return undefined;
}

function describeRegions(values: string[], names: { code: string; name: string }[], labels: Record<string, string> = {}): string {
  return values.map((v) => {
    const name = labels[v] ?? names.find((r) => r.code === v)?.name;
    return name ? `${v} (${name})` : v;
  }).join(", ");
}

/**
 * The region for a calculation: validated against the endpoint's region values. Returns `undefined` with a warning
 * when the calculation has no regional option (the region is then ignored rather than rejected).
 */
export function resolveCalcRegion(country: CountryInfo, kind: ToolKind, input: string | undefined): { region?: string; warning?: string } {
  const param = endpointParams(country, kind)?.find((p) => p.name === "region");
  // Labels first: an endpoint can name a region differently from the tax tables (UK "England & Northern Ireland").
  const names = [...Object.entries(param?.labels ?? {}).map(([code, name]) => ({ code, name })), ...country.endpoints["tax-tables"].regions];
  if (!input?.trim()) {
    // Checked here so the assistant gets the list of codes before any API call (the API answers the same way).
    if (param?.required) {
      const values = param.values ?? names.map((r) => r.code);
      throw new ToolInputError(`${country.name} ${KIND_NAME[kind]} needs a region: pass region as one of ${describeRegions(values, names, param.labels)}.`);
    }
    return {};
  }
  if (!param) return { warning: `Region "${input}" was ignored: this ${country.name} calculation does not vary by region.` };
  const values = param.values ?? names.map((r) => r.code);
  const match = matchRegionValue(input, values, names, param.aliases);
  if (!match) throw new ToolInputError(`Unknown ${country.name} region "${input}". Use one of: ${describeRegions(values, names, param.labels)}.`);
  return { region: match };
}

/** Region for tax tables: one of the regional tables, or none (national). */
export function resolveTableRegion(country: CountryInfo, input: string | undefined): { region?: string; warning?: string } {
  if (!input?.trim()) return {};
  const regions = country.endpoints["tax-tables"].regions;
  if (!regions.length) return { warning: `${country.name} has no regional tax tables; the national tables are shown.` };
  const match = matchRegionValue(input, regions.map((r) => r.code), regions);
  if (!match) {
    // A calculation-only region (e.g. England, a German state) has no separate table: show the national one.
    const ignored = norm(input);
    if (["england", "northern-ireland"].includes(ignored) && country.code === "uk") return {};
    throw new ToolInputError(`No ${country.name} regional tax tables for "${input}". Regional tables: ${describeRegions(regions.map((r) => r.code), regions)}. Leave region empty for the national tables.`);
  }
  return { region: match };
}

/** The table region that matches a calculation region (for the official-source lookup), if any. */
export function tableRegionFor(country: CountryInfo, calcRegion: string | undefined): string | undefined {
  if (!calcRegion) return undefined;
  return country.endpoints["tax-tables"].regions.some((r) => r.code === calcRegion) ? calcRegion : undefined;
}

/** Parameters each tool takes as its own arguments; the rest of an endpoint's parameters are country options. */
const CALC_RESERVED = ["country", "salary", "year", "region"];
const RESERVED: Record<ToolKind, Set<string>> = {
  "net-salary": new Set(CALC_RESERVED),
  "employer-cost": new Set(CALC_RESERVED),
  "supplemental-withholding": new Set([...CALC_RESERVED, "amount", "type"]),
  "equity-tax": new Set([...CALC_RESERVED, "instrument", "units", "grant_date", "event_date", "fmv_grant", "fmv_event", "exercise_price", "sale_price", "sale_date"]),
};
/** Tool argument names that differ from the API parameter. */
const ARG_NAME: Record<string, string> = { salary: "gross_salary" };

export function optionParams(country: CountryInfo, kind: ToolKind): CountryParam[] {
  return (endpointParams(country, kind) ?? []).filter((p) => !RESERVED[kind].has(p.name));
}

function describeParam(p: CountryParam): string {
  const range = p.values ? `one of ${p.values.join(" | ")}` : p.type === "number" && p.min !== undefined ? `number ${p.min} to ${p.max}${p.unit ? `, ${p.unit}` : ""}` : p.type;
  return `${p.name} (${range}${p.default !== undefined ? `, default ${String(p.default)}` : ""}): ${p.description}`;
}

export function describeOptions(country: CountryInfo, kind: ToolKind): string {
  const ps = optionParams(country, kind);
  return ps.length ? ps.map(describeParam).join("; ") : "none";
}

/** Validates and coerces country-specific options (filing status, pension, children...) against the live parameter list. */
export function resolveOptions(country: CountryInfo, kind: ToolKind, options: Record<string, unknown> | undefined): Record<string, QueryValue> {
  const out: Record<string, QueryValue> = {};
  if (!options) return out;
  const params = optionParams(country, kind);
  for (const [rawKey, raw] of Object.entries(options)) {
    if (raw === undefined || raw === null || raw === "") continue;
    const key = rawKey.trim().replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[\s-]+/g, "_");
    if (RESERVED[kind].has(key)) throw new ToolInputError(`Pass "${ARG_NAME[key] ?? key}" as its own argument, not inside options.`);
    const p = params.find((x) => x.name === key);
    if (!p) {
      throw new ToolInputError(
        `"${rawKey}" is not an option for ${country.name} (${KIND_NAME[kind]}). Options: ${describeOptions(country, kind)}.`,
      );
    }
    out[p.name] = coerce(p, raw, country.name);
  }
  return out;
}

function coerce(p: CountryParam, raw: unknown, countryName: string): QueryValue {
  const bad = (why: string) => new ToolInputError(`Option "${p.name}" for ${countryName}: ${why}. Expected ${describeParam(p)}.`);
  if (p.type === "boolean") {
    if (typeof raw === "boolean") return raw;
    const s = String(raw).trim().toLowerCase();
    if (["true", "yes", "1", "y", "on"].includes(s)) return true;
    if (["false", "no", "0", "n", "off"].includes(s)) return false;
    throw bad(`"${String(raw)}" is not true or false`);
  }
  if (p.type === "number" || p.type === "integer") {
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[,\s%]/g, ""));
    if (!Number.isFinite(n)) throw bad(`"${String(raw)}" is not a number`);
    if (p.min !== undefined && n < p.min) throw bad(`${n} is below ${p.min}`);
    if (p.max !== undefined && n > p.max) throw bad(`${n} is above ${p.max}`);
    return n;
  }
  if (p.values) {
    const s = String(raw).trim();
    const hit = matchEnum(p, s);
    if (hit === undefined) throw bad(`"${s}" is not allowed`);
    // Enum values can be numeric strings (e.g. payments 12 | 14).
    return hit;
  }
  return typeof raw === "number" || typeof raw === "boolean" ? raw : String(raw);
}

/** An enum value given as the value, in another case or spelling, by alias or by label; undefined when none matches. */
function matchEnum(p: CountryParam, s: string): string | undefined {
  const values = p.values ?? [];
  return (
    values.find((v) => v === s) ??
    values.find((v) => v.toLowerCase() === s.toLowerCase()) ??
    values.find((v) => norm(v) === norm(s)) ??
    optionAlias(p, s)
  );
}

/**
 * A per-country enum that is a tool argument of its own (supplemental `type`, equity `instrument`), resolved against
 * the country's parameter (values, aliases, labels): a value only other countries have gets the list this one accepts.
 */
export function resolveEnumArg(country: CountryInfo, kind: ToolKind, name: string, label: string, input: string | undefined): string | undefined {
  const s = input?.trim();
  if (!s) return undefined;
  const p = endpointParams(country, kind)?.find((x) => x.name === name);
  if (!p?.values) return s;
  const hit = matchEnum(p, s);
  if (hit !== undefined) return hit;
  const choices = p.values.map((v) => (p.labels?.[v] && p.labels[v] !== v ? `${v} (${p.labels[v]})` : v)).join(", ");
  throw new ToolInputError(`${label} "${s}" is not available for ${country.name} (${KIND_NAME[kind]}). Use one of: ${choices}.`);
}

/** The display name of an enum value (e.g. emi → "Enterprise Management Incentives (EMI) options"), or the value. */
export function enumLabel(country: CountryInfo, kind: ToolKind, name: string, value: string): string {
  return endpointParams(country, kind)?.find((x) => x.name === name)?.labels?.[value] ?? value;
}

/** Checks the salary against the endpoint's range and returns its meaning (e.g. monthly in Singapore). */
export function checkSalary(country: CountryInfo, kind: ToolKind, salary: number): string {
  const p = endpointParams(country, kind)?.find((x) => x.name === "salary");
  if (p?.min !== undefined && salary < p.min) throw new ToolInputError(`Salary must be at least ${p.min} for ${country.name}.`);
  if (p?.max !== undefined && salary > p.max) throw new ToolInputError(`Salary must be at most ${p.max} for ${country.name}.`);
  return p?.description ?? `Annual gross salary in ${country.currency}.`;
}

/** Spellings accepted for option values when the API (before 1.7) does not list its own aliases. */
const FALLBACK_SYNONYMS: Record<string, string> = {
  married: "mfj",
  married_joint: "mfj",
  married_jointly: "mfj",
  married_filing_jointly: "mfj",
  joint: "mfj",
  married_separately: "mfs",
  married_filing_separately: "mfs",
  head_of_household: "hoh",
  qualifying_surviving_spouse: "qss",
  qualifying_widow: "qss",
  qualifying_widower: "qss",
};

const aliasKey = (s: string) => norm(s).replace(/-/g, "_");

/** An option value given by alias ("married") or label ("Married filing jointly"), resolved to the canonical value. */
function optionAlias(p: CountryParam, raw: string): string | undefined {
  const values = p.values ?? [];
  const k = aliasKey(raw);
  const fromApi = p.aliases?.[k];
  if (fromApi && values.includes(fromApi)) return fromApi;
  const fromLabel = Object.entries(p.labels ?? {}).find(([, l]) => aliasKey(l) === k)?.[0];
  if (fromLabel && values.includes(fromLabel)) return fromLabel;
  const fallback = FALLBACK_SYNONYMS[k];
  return fallback && values.includes(fallback) ? fallback : undefined;
}
