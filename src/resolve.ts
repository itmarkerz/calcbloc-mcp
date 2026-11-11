import type { CountryInfo, CountryParam, QueryValue } from "./api.js";

/** Bad input the assistant can correct (returned as a tool error with guidance, never sent to the API). */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

export type CalcKind = "net-salary" | "employer-cost";

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
};

export function countryList(countries: CountryInfo[]): string {
  return countries.map((c) => `${c.code} (${c.name})`).join(", ");
}

export function resolveCountry(countries: CountryInfo[], input: string): CountryInfo {
  const n = norm(input);
  const direct = countries.find((c) => c.code === n || norm(c.name) === n);
  if (direct) return direct;
  const alias = COUNTRY_ALIASES[n];
  const viaAlias = alias ? countries.find((c) => c.code === alias) : undefined;
  if (viaAlias) return viaAlias;
  throw new ToolInputError(`CalcBloc does not cover "${input}". Countries available: ${countryList(countries)}.`);
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

function matchRegionValue(input: string, values: string[], names: { code: string; name: string }[]): string | undefined {
  const n = norm(input);
  const byValue = values.find((v) => norm(v) === n);
  if (byValue) return byValue;
  const named = names.find((r) => norm(r.name) === n || norm(r.code) === n);
  if (named && values.includes(named.code)) return named.code;
  return undefined;
}

function describeRegions(values: string[], names: { code: string; name: string }[]): string {
  return values.map((v) => {
    const name = names.find((r) => r.code === v)?.name;
    return name ? `${v} (${name})` : v;
  }).join(", ");
}

/**
 * The region for a calculation: validated against the endpoint's region values. Returns `undefined` with a warning
 * when the calculation has no regional option (the region is then ignored rather than rejected).
 */
export function resolveCalcRegion(country: CountryInfo, kind: CalcKind, input: string | undefined): { region?: string; warning?: string } {
  if (!input?.trim()) return {};
  const ep = country.endpoints[kind];
  const param = ep?.parameters.find((p) => p.name === "region");
  const names = country.endpoints["tax-tables"].regions;
  if (!param) return { warning: `Region "${input}" was ignored: this ${country.name} calculation does not vary by region.` };
  const values = param.values ?? names.map((r) => r.code);
  const match = matchRegionValue(input, values, names);
  if (!match) throw new ToolInputError(`Unknown ${country.name} region "${input}". Use one of: ${describeRegions(values, names)}.`);
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

const RESERVED = new Set(["country", "salary", "year", "region"]);

export function optionParams(country: CountryInfo, kind: CalcKind): CountryParam[] {
  return (country.endpoints[kind]?.parameters ?? []).filter((p) => !RESERVED.has(p.name));
}

function describeParam(p: CountryParam): string {
  const range = p.values ? `one of ${p.values.join(" | ")}` : p.type === "number" && p.min !== undefined ? `number ${p.min} to ${p.max}${p.unit ? `, ${p.unit}` : ""}` : p.type;
  return `${p.name} (${range}${p.default !== undefined ? `, default ${String(p.default)}` : ""}): ${p.description}`;
}

export function describeOptions(country: CountryInfo, kind: CalcKind): string {
  const ps = optionParams(country, kind);
  return ps.length ? ps.map(describeParam).join("; ") : "none";
}

/** Validates and coerces country-specific options (filing status, pension, children...) against the live parameter list. */
export function resolveOptions(country: CountryInfo, kind: CalcKind, options: Record<string, unknown> | undefined): Record<string, QueryValue> {
  const out: Record<string, QueryValue> = {};
  if (!options) return out;
  const params = optionParams(country, kind);
  for (const [rawKey, raw] of Object.entries(options)) {
    if (raw === undefined || raw === null || raw === "") continue;
    const key = rawKey.trim().replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[\s-]+/g, "_");
    if (RESERVED.has(key)) throw new ToolInputError(`Pass "${key}" as its own argument, not inside options.`);
    const p = params.find((x) => x.name === key);
    if (!p) {
      throw new ToolInputError(
        `"${rawKey}" is not an option for ${country.name} (${kind}). Options: ${describeOptions(country, kind)}.`,
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
    const hit = p.values.find((v) => v === s) ?? p.values.find((v) => v.toLowerCase() === s.toLowerCase()) ?? p.values.find((v) => norm(v) === norm(s));
    if (hit === undefined) throw bad(`"${s}" is not allowed`);
    // Enum values can be numeric strings (e.g. payments 12 | 14).
    return hit;
  }
  return typeof raw === "number" || typeof raw === "boolean" ? raw : String(raw);
}

/** Checks the salary against the endpoint's range and returns its meaning (e.g. monthly in Singapore). */
export function checkSalary(country: CountryInfo, kind: CalcKind, salary: number): string {
  const p = country.endpoints[kind]?.parameters.find((x) => x.name === "salary");
  if (p?.min !== undefined && salary < p.min) throw new ToolInputError(`Salary must be at least ${p.min} for ${country.name}.`);
  if (p?.max !== undefined && salary > p.max) throw new ToolInputError(`Salary must be at most ${p.max} for ${country.name}.`);
  return p?.description ?? `Annual gross salary in ${country.currency}.`;
}
