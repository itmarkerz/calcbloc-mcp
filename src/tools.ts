import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { CalcBlocApiError, type CalcBlocClient, type CalcResponse, type CompareSide, type CountryInfo, type QueryValue, type Source, type TaxTable } from "./api.js";
import { ATTRIBUTION, DATA_LICENCE, DATA_URL, DISCLAIMER } from "./constants.js";
import { money, pct, renderSection, round2, sectionSources, sourceLines, tableSources, tagPageLinks, tagPageLinksDeep, uniqueSources } from "./format.js";
import {
  type CalcKind,
  checkSalary,
  describeOptions,
  optionParams,
  requireCalc,
  resolveCalcRegion,
  resolveCalcYear,
  resolveCountry,
  resolveOptions,
  resolveTableRegion,
  resolveTableYear,
  tableRegionFor,
  ToolInputError,
} from "./resolve.js";

/* ------------------------------------------------------------------ schemas ------------------------------------------------------------------ */

const SourceSchema = z.object({
  title: z.string().optional(),
  url: z.string().describe("Official government or statutory source."),
  retrievedAt: z.string().optional().describe("Date CalcBloc last checked the source."),
});

const CREDIT = {
  sources: z.array(SourceSchema).describe("Official sources for the rates used."),
  calcblocUrl: z.string().describe("The calcbloc.com page for this result."),
  attribution: z.string().describe('Always "Data by CalcBloc"; show it with the figures.'),
  attributionUrl: z.string(),
  licence: z.string(),
  disclaimer: z.string(),
  warnings: z.array(z.string()),
};

const BreakdownSchema = z
  .object({ title: z.string(), columns: z.array(z.string()), rows: z.array(z.object({ label: z.string(), values: z.array(z.number()) })) })
  .nullable();

const OptionsInput = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .optional()
  .describe(
    'Country-specific options, e.g. US {"filing_status":"married","children":2}, UK {"pension_pct":5,"student_loan":"plan2"}, Germany {"tax_class":3,"church":true}. Call list_countries with the country to see every option.',
  );

const TakeHomeOutput = z.object({
  country: z.string(),
  countryName: z.string(),
  region: z.string().nullable(),
  taxYear: z.string(),
  currency: z.string(),
  grossSalary: z.number(),
  salaryMeaning: z.string(),
  netAnnual: z.number().nullable(),
  totalDeductions: z.number().nullable(),
  effectiveRate: z.number().nullable().describe("Share of gross pay deducted, 0 to 1."),
  results: z.record(z.string(), z.number()),
  breakdown: BreakdownSchema,
  notes: z.array(z.string()),
  inputs: z.record(z.string(), z.unknown()),
  taxTablesUrl: z.string(),
  ...CREDIT,
});

const EmployerCostOutput = z.object({
  country: z.string(),
  countryName: z.string(),
  region: z.string().nullable(),
  taxYear: z.string(),
  currency: z.string(),
  grossSalary: z.number(),
  salaryMeaning: z.string(),
  totalCost: z.number().nullable(),
  monthlyCost: z.number().nullable(),
  multiplier: z.number().nullable(),
  results: z.record(z.string(), z.number()),
  breakdown: BreakdownSchema,
  notes: z.array(z.string()),
  inputs: z.record(z.string(), z.unknown()),
  taxTablesUrl: z.string(),
  ...CREDIT,
});

const SideSchema = z.object({
  country: z.string(),
  countryName: z.string(),
  place: z.string(),
  taxYear: z.string(),
  currency: z.string(),
  gross: z.number(),
  incomeTax: z.number(),
  contributions: z.number(),
  net: z.number(),
  effectiveRate: z.number(),
  grossInOtherCurrency: z.number(),
  netInOtherCurrency: z.number(),
  parts: z.array(z.object({ label: z.string(), amount: z.number() })),
  assumptions: z.array(z.string()),
  taxTablesUrl: z.string(),
});

const CompareOutput = z.object({
  taxYear: z.string().describe("Tax year of each side, e.g. 2026-27 (United Kingdom) / 2026 (Germany)."),
  salary: z.number(),
  currency: z.string(),
  a: SideSchema,
  b: SideSchema,
  exchangeRate: z.object({ pair: z.string(), rate: z.number().nullable(), date: z.string().nullable(), note: z.string().nullable() }),
  difference: z.object({ inACurrency: z.number(), inBCurrency: z.number(), percentOfA: z.number(), deductionRateGapPoints: z.number() }),
  interpretation: z.string(),
  ...CREDIT,
});

const TableSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  group: z.string(),
  kind: z.string(),
  basis: z.string().optional(),
  note: z.string().optional(),
  rows: z.array(z.record(z.string(), z.unknown())),
  source: SourceSchema.optional(),
  underReview: z.boolean(),
});

const TaxTablesOutput = z.object({
  country: z.string(),
  countryName: z.string(),
  region: z.string().nullable(),
  taxYear: z.string(),
  yearLabel: z.string(),
  effectiveFrom: z.string().nullable(),
  effectiveTo: z.string().nullable(),
  currency: z.string(),
  status: z.string().nullable(),
  sectionIndex: z.array(z.object({ id: z.string(), title: z.string(), group: z.string(), rows: z.number() })),
  sections: z.array(TableSectionSchema),
  truncated: z.boolean().describe("True when only the section index is returned; call again with group or sections."),
  yearsAvailable: z.array(z.string()),
  dataOrigin: z.enum(["api", "local"]),
  apiUrl: z.string(),
  csvUrl: z.string(),
  ...CREDIT,
});

const CountrySummarySchema = z.object({
  code: z.string(),
  name: z.string(),
  currency: z.string(),
  currentYear: z.string(),
  yearsAvailable: z.array(z.string()),
  takeHomePay: z.boolean(),
  employerCost: z.boolean(),
  compare: z.boolean(),
  taxTables: z.boolean(),
  taxTablesUrl: z.string(),
});

const ListCountriesOutput = z.object({
  countries: z.array(CountrySummarySchema),
  details: z
    .object({
      code: z.string(),
      taxTableRegions: z.array(z.object({ code: z.string(), name: z.string() })),
      takeHomePay: z.object({ calculatorUrl: z.string(), salary: z.string(), regions: z.array(z.string()), options: z.array(z.record(z.string(), z.unknown())) }).nullable(),
      employerCost: z.object({ calculatorUrl: z.string(), salary: z.string(), regions: z.array(z.string()), options: z.array(z.record(z.string(), z.unknown())) }).nullable(),
    })
    .nullable(),
  ...CREDIT,
});

/* ------------------------------------------------------------------ helpers ------------------------------------------------------------------ */

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const MAX_SOURCES_PER_TABLE = 12;
const MAX_TABLE_TEXT = 30_000;

/** Every result goes through ok() or fail(), so calcbloc.com page links shown to users carry the referral tag (see pageLink). */
function ok(text: string, structured: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: tagPageLinks(text) }], structuredContent: tagPageLinksDeep(structured) };
}

function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: tagPageLinks(message) }], isError: true };
}

/** Turns any failure into a tool error the assistant can act on (input problems, API errors, rate limits). */
async function guarded(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ToolInputError) return fail(e.message);
    if (e instanceof CalcBlocApiError) {
      const docs = e.docs && e.code !== "rate_limited" ? ` (API docs: ${e.docs})` : "";
      return fail(`CalcBloc API error [${e.code}]: ${e.message}${docs}`);
    }
    return fail(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function creditFooter(sources: Source[], pageUrl: string, warnings: string[]): string[] {
  const lines: string[] = [];
  if (warnings.length) lines.push("", "Warnings:", ...warnings.map((w) => `- ${w}`));
  lines.push("", "Official sources:", ...sourceLines(sources));
  lines.push("", DISCLAIMER, `${ATTRIBUTION}: ${pageUrl} (licence ${DATA_LICENCE}, ${DATA_URL})`);
  return lines;
}

function creditFields(sources: Source[], pageUrl: string, warnings: string[]) {
  return { sources, calcblocUrl: pageUrl, attribution: ATTRIBUTION, attributionUrl: pageUrl, licence: DATA_LICENCE, disclaimer: DISCLAIMER, warnings };
}

/** Section groups whose sources back each kind of calculation. */
const SOURCE_GROUPS: Record<CalcKind | "compare", string[]> = {
  "net-salary": ["income-tax", "employee"],
  "employer-cost": ["employer"],
  compare: ["income-tax", "employee"],
};

function capSources(list: Source[], pageUrl: string, warnings: string[]): Source[] {
  if (list.length <= MAX_SOURCES_PER_TABLE) return list;
  const more = list.length - MAX_SOURCES_PER_TABLE;
  warnings.push(`${more} further official source${more === 1 ? " is" : "s are"} listed on ${pageUrl}.`);
  return list.slice(0, MAX_SOURCES_PER_TABLE);
}

/**
 * Official sources for a calculation, from the country's tax table for the same year (plus the regional table).
 * Never fails the calculation: on error it returns no sources and a warning pointing to the tax-table page.
 */
async function calcSources(
  client: CalcBlocClient,
  country: CountryInfo,
  kind: CalcKind | "compare",
  tableRegion: string | undefined,
  warnings: string[],
): Promise<{ sources: Source[]; taxTablesUrl: string }> {
  const groups = SOURCE_GROUPS[kind];
  const pick = (t: TaxTable) => {
    const fromSections = sectionSources(t.sections.filter((s) => groups.includes(s.group)));
    return fromSections.length ? fromSections : tableSources(t);
  };
  const jobs = [client.taxTable(country.code, country.current_year), ...(tableRegion ? [client.taxTable(country.code, country.current_year, tableRegion)] : [])];
  const settled = await Promise.allSettled(jobs);
  let taxTablesUrl = country.endpoints["tax-tables"].pageUrl;
  const sources: Source[] = [];
  // Regional table first (most specific), then the national one; both filtered to the groups the calculation uses.
  for (const r of [...settled].reverse()) {
    if (r.status === "fulfilled") {
      const t = r.value.table;
      if (t.region) taxTablesUrl = t.pageUrl;
      sources.push(...pick(t));
    } else {
      const why = r.reason instanceof Error ? r.reason.message : String(r.reason);
      warnings.push(`The official source list for ${country.name} could not be loaded (${why}). The sources are listed on ${taxTablesUrl}.`);
    }
  }
  return { sources: capSources(uniqueSources(sources), taxTablesUrl, warnings), taxTablesUrl };
}

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1).replace(/\.$/, "");

function inputsLine(inputs: Record<string, unknown>): string {
  return Object.entries(inputs)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(", ");
}

function breakdownLines(r: CalcResponse): string[] {
  if (!r.breakdown) return [];
  const lines = ["", `${r.breakdown.title} (${r.breakdown.columns.join(" | ")}, ${r.currency}):`];
  for (const row of r.breakdown.rows) lines.push(`- ${row.label}: ${row.values.map((v) => round2(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })).join(" | ")}`);
  return lines;
}

function regionName(country: CountryInfo, region: string | undefined): string {
  if (!region) return "";
  const n = country.endpoints["tax-tables"].regions.find((r) => r.code === region)?.name;
  return n ?? region;
}

/* ------------------------------------------------------------------ handlers ----------------------------------------------------------------- */

export interface CalcArgs {
  country: string;
  gross_salary: number;
  region?: string;
  year?: string;
  options?: Record<string, string | number | boolean>;
}

/** Calculations need the API; with only a local data folder, say so instead of calling every country tables-only. */
async function onlineCountries(client: CalcBlocClient): Promise<CountryInfo[]> {
  const countries = await client.countries();
  if (client.offlineReason)
    throw new CalcBlocApiError(
      0,
      "network_error",
      `${client.offlineReason} Calculations need the CalcBloc API; tax tables are still available from the local data folder (get_tax_tables).`,
    );
  return countries;
}

async function prepareCalc(client: CalcBlocClient, kind: CalcKind, args: CalcArgs) {
  const countries = await onlineCountries(client);
  const country = resolveCountry(countries, args.country);
  const ep = requireCalc(country, kind);
  const year = resolveCalcYear(country, args.year);
  const salaryMeaning = checkSalary(country, kind, args.gross_salary);
  const warnings: string[] = [];
  const { region, warning } = resolveCalcRegion(country, kind, args.region);
  if (warning) warnings.push(warning);
  const options = resolveOptions(country, kind, args.options);
  const query: Record<string, QueryValue> = { country: country.code, salary: args.gross_salary, year, ...(region ? { region } : {}), ...options };
  return { country, ep, year, salaryMeaning, warnings, region, query };
}

export async function takeHomePay(client: CalcBlocClient, args: CalcArgs): Promise<ToolResult> {
  return guarded(async () => {
    const p = await prepareCalc(client, "net-salary", args);
    const [r, src] = await Promise.all([client.netSalary(p.query), calcSources(client, p.country, "net-salary", tableRegionFor(p.country, p.region), p.warnings)]);
    const warnings = [...p.warnings, ...(r.warnings ?? [])];
    const s = r.summary;
    const gross = s.grossAnnual ?? args.gross_salary;
    const place = p.region ? `${r.countryName} (${regionName(p.country, p.region)})` : r.countryName;
    const lines = [
      `Take-home pay in ${place}, tax year ${r.year}`,
      `Gross salary: ${money(gross, r.currency)} (${lowerFirst(p.salaryMeaning)})`,
      `Take-home pay: ${money(s.netAnnual, r.currency)} a year`,
    ];
    if (s.totalDeductions !== null && s.totalDeductions !== undefined) lines.push(`Total deductions: ${money(s.totalDeductions, r.currency)}`);
    if (s.effectiveRate !== null && s.effectiveRate !== undefined) lines.push(`Effective deduction rate: ${pct(s.effectiveRate)}`);
    lines.push(...breakdownLines(r));
    if (r.notes.length) lines.push("", "Notes:", ...r.notes.map((n) => `- ${n}`));
    lines.push("", `Inputs used: ${inputsLine(r.inputs)}`);
    lines.push(`Calculator: ${r.calculatorUrl}`, `Tax tables: ${src.taxTablesUrl}`);
    lines.push(...creditFooter(src.sources, r.calculatorUrl, warnings));
    return ok(lines.join("\n"), {
      country: r.country,
      countryName: r.countryName,
      region: p.region ?? null,
      taxYear: r.year,
      currency: r.currency,
      grossSalary: gross,
      salaryMeaning: p.salaryMeaning,
      netAnnual: s.netAnnual ?? null,
      totalDeductions: s.totalDeductions ?? null,
      effectiveRate: s.effectiveRate ?? null,
      results: r.results,
      breakdown: r.breakdown,
      notes: r.notes,
      inputs: r.inputs,
      taxTablesUrl: src.taxTablesUrl,
      ...creditFields(src.sources, r.calculatorUrl, warnings),
    });
  });
}

export async function employerCost(client: CalcBlocClient, args: CalcArgs): Promise<ToolResult> {
  return guarded(async () => {
    const p = await prepareCalc(client, "employer-cost", args);
    const [r, src] = await Promise.all([client.employerCost(p.query), calcSources(client, p.country, "employer-cost", tableRegionFor(p.country, p.region), p.warnings)]);
    const warnings = [...p.warnings, ...(r.warnings ?? [])];
    const s = r.summary;
    const place = p.region ? `${r.countryName} (${regionName(p.country, p.region)})` : r.countryName;
    const lines = [
      `Employer cost in ${place}, tax year ${r.year}`,
      `Gross salary: ${money(args.gross_salary, r.currency)} (${lowerFirst(p.salaryMeaning)})`,
      `Total cost to the employer: ${money(s.totalCost, r.currency)} a year`,
    ];
    if (s.monthlyCost !== null && s.monthlyCost !== undefined) lines.push(`Monthly cost: ${money(s.monthlyCost, r.currency)}`);
    if (s.multiplier !== null && s.multiplier !== undefined) lines.push(`Cost multiplier: ${s.multiplier} × salary`);
    lines.push(...breakdownLines(r));
    if (r.notes.length) lines.push("", "Notes:", ...r.notes.map((n) => `- ${n}`));
    lines.push("", `Inputs used: ${inputsLine(r.inputs)}`);
    lines.push(`Calculator: ${r.calculatorUrl}`, `Tax tables: ${src.taxTablesUrl}`);
    lines.push(...creditFooter(src.sources, r.calculatorUrl, warnings));
    return ok(lines.join("\n"), {
      country: r.country,
      countryName: r.countryName,
      region: p.region ?? null,
      taxYear: r.year,
      currency: r.currency,
      grossSalary: args.gross_salary,
      salaryMeaning: p.salaryMeaning,
      totalCost: s.totalCost ?? null,
      monthlyCost: s.monthlyCost ?? null,
      multiplier: s.multiplier ?? null,
      results: r.results,
      breakdown: r.breakdown,
      notes: r.notes,
      inputs: r.inputs,
      taxTablesUrl: src.taxTablesUrl,
      ...creditFields(src.sources, r.calculatorUrl, warnings),
    });
  });
}

/** Region parameter names of /compare, by country code. */
const COMPARE_REGION_PARAM: Record<string, string> = { us: "us_state", uk: "uk_region", canada: "ca_province", india: "in_state" };

export interface CompareArgs {
  country_a: string;
  country_b: string;
  gross_salary: number;
  currency?: string;
  region_a?: string;
  region_b?: string;
}

export async function compareCountries(client: CalcBlocClient, args: CompareArgs): Promise<ToolResult> {
  return guarded(async () => {
    const countries = await onlineCountries(client);
    const a = resolveCountry(countries, args.country_a);
    const b = resolveCountry(countries, args.country_b);
    if (a.code === b.code) throw new ToolInputError("Choose two different countries. To compare regions or options within one country, call calculate_take_home_pay twice.");
    for (const c of [a, b]) {
      if (!c.available_endpoints.includes("compare"))
        throw new ToolInputError(
          `Salary comparison is not available for ${c.name} yet. Countries that can be compared: ${countries.filter((x) => x.available_endpoints.includes("compare")).map((x) => x.code).join(", ")}. ${c.name}'s tax tables: ${c.endpoints["tax-tables"].pageUrl}.`,
        );
    }
    const currency = (args.currency ?? a.currency).trim().toUpperCase();
    if (currency !== a.currency && currency !== b.currency) throw new ToolInputError(`currency must be ${a.currency} (${a.name}) or ${b.currency} (${b.name}).`);
    const warnings: string[] = [];
    const query: Record<string, QueryValue> = { a: a.code, b: b.code, salary: args.gross_salary, currency };
    const regionOf: Record<string, string | undefined> = {};
    for (const [c, input] of [[a, args.region_a], [b, args.region_b]] as const) {
      if (!input?.trim()) continue;
      const param = COMPARE_REGION_PARAM[c.code];
      if (!param) {
        warnings.push(`Region "${input}" was ignored: the comparison uses ${c.name}'s national defaults.`);
        continue;
      }
      const { region } = resolveCalcRegion(c, "net-salary", input);
      if (region) {
        query[param] = region;
        regionOf[c.code] = region;
      }
    }
    const [r, srcA, srcB] = await Promise.all([
      client.compare(query),
      calcSources(client, a, "compare", tableRegionFor(a, regionOf[a.code]), warnings),
      calcSources(client, b, "compare", tableRegionFor(b, regionOf[b.code]), warnings),
    ]);
    warnings.push(...(r.warnings ?? []));
    const pairKey = Object.keys(r.exchangeRate).find((k) => /^[A-Z]{3}_[A-Z]{3}$/.test(k));
    const rate = pairKey ? Number(r.exchangeRate[pairKey]) : null;
    const side = (s: CompareSide, c: CountryInfo, tablesUrl: string) => ({
      country: s.country,
      countryName: c.name,
      place: s.place,
      taxYear: c.current_year,
      currency: s.currency,
      gross: s.gross,
      incomeTax: s.incomeTax,
      contributions: s.contributions,
      net: s.net,
      effectiveRate: s.effectiveRate,
      grossInOtherCurrency: s.grossInOtherCurrency,
      netInOtherCurrency: s.netInOtherCurrency,
      parts: s.parts,
      assumptions: s.assumptions,
      taxTablesUrl: tablesUrl,
    });
    const sa = side(r.a, a, srcA.taxTablesUrl);
    const sb = side(r.b, b, srcB.taxTablesUrl);
    const taxYear = `${a.current_year} (${a.name}) / ${b.current_year} (${b.name})`;
    const sideLines = (s: typeof sa) => [
      `${s.place === s.countryName || s.place === s.country ? s.countryName : `${s.place}, ${s.countryName}`} (tax year ${s.taxYear}):`,
      `- Gross: ${money(s.gross, s.currency)}`,
      ...s.parts.map((p) => `- ${p.label}: ${money(p.amount, s.currency)}`),
      `- Take-home pay: ${money(s.net, s.currency)} (${pct(s.effectiveRate)} deducted)`,
      `- Assumptions: ${s.assumptions.join("; ")}`,
    ];
    const lines = [
      `Salary comparison: ${a.name} vs ${b.name}, ${money(args.gross_salary, currency)} a year`,
      "",
      ...sideLines(sa),
      "",
      ...sideLines(sb),
      "",
      r.interpretation,
      `Exchange rate: ${pairKey && rate ? `1 ${pairKey.slice(0, 3)} = ${Number(rate.toFixed(4))} ${pairKey.slice(4)}` : "n/a"}${r.exchangeRate.note ? `, ${r.exchangeRate.note}` : ""}`,
      `Comparison page: ${r.calculatorUrl}`,
      `Tax tables: ${sa.taxTablesUrl} and ${sb.taxTablesUrl}`,
      ...creditFooter([...srcA.sources, ...srcB.sources], r.calculatorUrl, warnings),
    ];
    return ok(lines.join("\n"), {
      taxYear,
      salary: args.gross_salary,
      currency,
      a: sa,
      b: sb,
      exchangeRate: { pair: pairKey ?? "", rate, date: r.exchangeRate.date ?? null, note: r.exchangeRate.note ?? null },
      difference: r.difference,
      interpretation: r.interpretation,
      ...creditFields(uniqueSources([...srcA.sources, ...srcB.sources]), r.calculatorUrl, warnings),
    });
  });
}

export interface TaxTablesArgs {
  country: string;
  year?: string;
  region?: string;
  group?: "income-tax" | "employee" | "employer" | "other";
  sections?: string[];
}

export async function taxTables(client: CalcBlocClient, args: TaxTablesArgs): Promise<ToolResult> {
  return guarded(async () => {
    const countries = await client.countries();
    const country = resolveCountry(countries, args.country);
    const year = resolveTableYear(country, args.year);
    const warnings: string[] = [];
    const { region, warning } = resolveTableRegion(country, args.region);
    if (warning) warnings.push(warning);
    const { table: t, origin } = await client.taxTable(country.code, year, region);
    const underReview = t.underReview ?? [];

    let sections = t.sections;
    if (args.group) sections = sections.filter((s) => s.group === args.group);
    if (args.sections?.length) {
      const wanted = new Set(args.sections.map((s) => s.trim()));
      const unknown = [...wanted].filter((id) => !t.sections.some((s) => s.id === id));
      if (unknown.length) warnings.push(`Unknown section id(s): ${unknown.join(", ")}. See sectionIndex for the ids.`);
      sections = sections.filter((s) => wanted.has(s.id));
    }
    if (args.group && !sections.length) warnings.push(`No "${args.group}" sections in this table.`);

    const index = t.sections.map((s) => ({ id: s.id, title: s.title, group: s.group, rows: s.rows.length }));
    const body = sections.flatMap((s) => ["", ...renderSection(s, t.currency, underReview)]);
    const truncated = body.join("\n").length > MAX_TABLE_TEXT && !args.sections?.length;
    const regionPart = t.region ? `, ${t.region.name}` : "";
    const period = t.effectiveFrom ? ` (in force ${t.effectiveFrom} to ${t.effectiveTo ?? "further notice"})` : "";
    const apiUrl = `${client.apiUrl}/tax-tables/${t.country}/${t.year}${t.region ? `?region=${t.region.code}` : ""}`;
    const csvUrl = `${apiUrl}${t.region ? "&" : "?"}format=csv`;
    const lines = [`Tax tables: ${t.countryName}${regionPart}, tax year ${t.yearLabel ?? t.year}${period}`, `Currency: ${t.currency}. Status: ${t.status ?? "n/a"}${underReview.length ? `; under review: ${underReview.join(", ")}` : ""}.`];
    if (country.years_available.length > 1) lines.push(`Other years: ${country.years_available.filter((y) => y !== t.year).join(", ")}.`);
    if (truncated) {
      warnings.push("The full table is long, so only the section index is shown. Call get_tax_tables again with group (income-tax, employee, employer, other) or sections (ids below).");
      lines.push("", "Sections:", ...index.map((s) => `- ${s.id} [${s.group}]: ${s.title} (${s.rows} rows)`));
    } else {
      lines.push(...body);
    }
    const shown = truncated ? [] : sections;
    const sources = args.group || args.sections?.length ? sectionSources(sections) : tableSources(t);
    lines.push("", `Page: ${t.pageUrl}`, `Download: ${csvUrl}`);
    if (origin === "local") lines.push("(Read from the local CalcBloc data folder set in CALCBLOC_DATA_DIR.)");
    lines.push(...creditFooter(sources, t.pageUrl, warnings));
    return ok(lines.join("\n"), {
      country: t.country,
      countryName: t.countryName,
      region: t.region?.code ?? null,
      taxYear: t.year,
      yearLabel: t.yearLabel ?? t.year,
      effectiveFrom: t.effectiveFrom ?? null,
      effectiveTo: t.effectiveTo ?? null,
      currency: t.currency,
      status: t.status ?? null,
      sectionIndex: index,
      sections: shown.map((s) => ({
        id: s.id,
        title: s.title,
        group: s.group,
        kind: s.kind,
        ...(s.basis ? { basis: s.basis } : {}),
        ...(s.note ? { note: s.note } : {}),
        rows: s.rows as unknown as Record<string, unknown>[],
        ...(s.source ? { source: s.source } : {}),
        underReview: underReview.includes(s.id),
      })),
      truncated,
      yearsAvailable: country.years_available,
      dataOrigin: origin,
      apiUrl,
      csvUrl,
      ...creditFields(sources, t.pageUrl, warnings),
    });
  });
}

export async function listCountries(client: CalcBlocClient, args: { country?: string }): Promise<ToolResult> {
  return guarded(async () => {
    const countries = await client.countries();
    const summary = countries.map((c) => ({
      code: c.code,
      name: c.name,
      currency: c.currency,
      currentYear: c.current_year,
      yearsAvailable: c.years_available,
      takeHomePay: !!c.endpoints["net-salary"],
      employerCost: !!c.endpoints["employer-cost"],
      compare: c.available_endpoints.includes("compare"),
      taxTables: true,
      taxTablesUrl: c.endpoints["tax-tables"].pageUrl,
    }));
    const pageUrl = "https://calcbloc.com/developers";
    const warnings: string[] = [];
    if (!args.country) {
      const calc = summary.filter((c) => c.takeHomePay);
      const lines = [
        `CalcBloc covers ${summary.length} countries. Tax tables are available for all of them; take-home pay calculations for ${calc.length}.`,
        "",
        ...summary.map((c) => {
          const what = [c.takeHomePay && "take-home pay", c.employerCost && "employer cost", c.compare && "compare", "tax tables"].filter(Boolean).join(", ");
          return `- ${c.code}: ${c.name} (${c.currency}), tax year ${c.currentYear}${c.yearsAvailable.length > 1 ? ` (tables also ${c.yearsAvailable.slice(1).join(", ")})` : ""}: ${what}`;
        }),
        "",
        "Call list_countries with a country code for its regions and calculation options.",
        "",
        `${ATTRIBUTION}: ${pageUrl}`,
      ];
      return ok(lines.join("\n"), { countries: summary, details: null, ...creditFields([], pageUrl, warnings) });
    }
    const c = resolveCountry(countries, args.country);
    const calc = (kind: CalcKind) => {
      const ep = c.endpoints[kind];
      if (!ep) return null;
      const salary = ep.parameters.find((p) => p.name === "salary")?.description ?? "";
      const regions = ep.parameters.find((p) => p.name === "region")?.values ?? [];
      return { calculatorUrl: ep.calculatorUrl, salary, regions, options: optionParams(c, kind) as unknown as Record<string, unknown>[] };
    };
    const details = { code: c.code, taxTableRegions: c.endpoints["tax-tables"].regions, takeHomePay: calc("net-salary"), employerCost: calc("employer-cost") };
    const lines = [`${c.name} (${c.code}), currency ${c.currency}, current tax year ${c.current_year}; tax-table years: ${c.years_available.join(", ")}.`, `Tax tables: ${c.endpoints["tax-tables"].pageUrl}`];
    lines.push(details.taxTableRegions.length ? `Regional tax tables: ${details.taxTableRegions.map((r) => `${r.code} (${r.name})`).join(", ")}` : "No regional tax tables.");
    for (const [label, kind, d] of [["Take-home pay", "net-salary", details.takeHomePay], ["Employer cost", "employer-cost", details.employerCost]] as const) {
      if (!d) {
        lines.push("", `${label}: not available yet (tax tables only).`);
        continue;
      }
      lines.push("", `${label} (${d.calculatorUrl}):`, `- gross_salary: ${d.salary}`);
      if (d.regions.length) lines.push(`- region: ${d.regions.join(", ")}`);
      lines.push(`- options: ${describeOptions(c, kind)}`);
    }
    lines.push("", `${ATTRIBUTION}: ${pageUrl}`);
    return ok(lines.join("\n"), { countries: summary.filter((s) => s.code === c.code), details, ...creditFields([], c.endpoints["tax-tables"].pageUrl, warnings) });
  });
}

/* ------------------------------------------------------------------ registration ------------------------------------------------------------- */

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const countryArg = z.string().min(2).max(60).describe('Country code or name, e.g. "us", "uk", "canada", "germany", "india", "australia". See list_countries.');
const salaryArg = z
  .number()
  .positive()
  .max(10_000_000)
  .describe("Gross salary before tax in the country's currency. Annual for every country except Singapore (monthly); India: annual CTC/gross as described by list_countries.");
const yearArg = z.string().max(10).optional().describe('Tax year, e.g. "2026" or "2026-27". Default: the current year. Calculations use the current year only.');

export function registerTools(server: McpServer, client: CalcBlocClient): void {
  server.registerTool(
    "calculate_take_home_pay",
    {
      title: "Calculate take-home pay",
      description:
        "Net (take-home) pay after income tax and employee social security for a gross salary, with a line-by-line breakdown, using official rates for the current tax year. Supports regions (US states, UK nations, Canadian provinces, Spanish communities, German states, Indian states) and country-specific options. Returns the tax year, official source URLs and the calcbloc.com page.",
      inputSchema: z.object({
        country: countryArg,
        gross_salary: salaryArg,
        region: z.string().max(60).optional().describe('Region code or name where the calculation varies by region, e.g. US "ca", UK "scotland", Canada "on", Spain "md", Germany "by".'),
        year: yearArg,
        options: OptionsInput,
      }),
      outputSchema: TakeHomeOutput,
      annotations: { ...READ_ONLY },
    },
    async (args) => takeHomePay(client, args),
  );

  server.registerTool(
    "calculate_employer_cost",
    {
      title: "Calculate employer cost",
      description:
        "Total cost of employing someone on a gross salary: the salary plus employer social security, payroll taxes, pension and other on-costs, with a breakdown, for the current tax year. Returns the tax year, official source URLs and the calcbloc.com page.",
      inputSchema: z.object({
        country: countryArg,
        gross_salary: salaryArg,
        region: z.string().max(60).optional().describe("Region code or name where employer costs vary by region (e.g. US state, Canadian province, Spanish community, Australian state)."),
        year: yearArg,
        options: OptionsInput,
      }),
      outputSchema: EmployerCostOutput,
      annotations: { ...READ_ONLY },
    },
    async (args) => employerCost(client, args),
  );

  server.registerTool(
    "compare_countries",
    {
      title: "Compare take-home pay in two countries",
      description:
        "The same gross salary in two countries: take-home pay, income tax and contributions on each side, converted at the European Central Bank reference rate, with a plain-English summary. Returns each side's tax year and official sources.",
      inputSchema: z.object({
        country_a: countryArg,
        country_b: countryArg,
        gross_salary: z.number().positive().max(10_000_000).describe("Annual gross salary, in `currency`."),
        currency: z.string().length(3).optional().describe("Currency of gross_salary: country A's or country B's (ISO code). Default: country A's."),
        region_a: z.string().max(60).optional().describe("Region in country A (used for the US, UK, Canada and India)."),
        region_b: z.string().max(60).optional().describe("Region in country B (used for the US, UK, Canada and India)."),
      }),
      outputSchema: CompareOutput,
      annotations: { ...READ_ONLY },
    },
    async (args) => compareCountries(client, args),
  );

  server.registerTool(
    "get_tax_tables",
    {
      title: "Get official tax tables",
      description:
        "Official tax tables for a country and year: income tax bands, allowances, employee and employer social security rates and thresholds, each with its official source and the date it was checked. Available for every listed country, including those without calculations. Filter with group or sections for long tables.",
      inputSchema: z.object({
        country: countryArg,
        year: z.string().max(10).optional().describe('Tax year, e.g. "2026" or "2025-26". Default: latest.'),
        region: z.string().max(60).optional().describe("Regional table, e.g. a US state (ca), Canadian province (qc), UK nation (scotland), Swiss canton, Spanish community."),
        group: z.enum(["income-tax", "employee", "employer", "other"]).optional().describe("Only sections of this group."),
        sections: z.array(z.string().max(80)).max(30).optional().describe("Only these section ids (from sectionIndex)."),
      }),
      outputSchema: TaxTablesOutput,
      annotations: { ...READ_ONLY },
    },
    async (args) => taxTables(client, args),
  );

  server.registerTool(
    "list_countries",
    {
      title: "List supported countries",
      description:
        "Countries CalcBloc covers, their current tax year, and which tools work for each. With a country, also its regions and the country-specific options accepted by calculate_take_home_pay and calculate_employer_cost.",
      inputSchema: z.object({ country: z.string().max(60).optional().describe("Country code or name for details.") }),
      outputSchema: ListCountriesOutput,
      annotations: { ...READ_ONLY },
    },
    async (args) => listCountries(client, args),
  );
}

