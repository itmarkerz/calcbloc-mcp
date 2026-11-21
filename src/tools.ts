import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  CalcBlocApiError,
  type CalcBlocClient,
  type CalcResponse,
  type CompareSide,
  type CountryInfo,
  type EquityLine,
  type QueryValue,
  type ResultSource,
  type Source,
  type SupplementalLine,
  type TaxTable,
} from "./api.js";
import { API_KEY_URL_APP, ATTRIBUTION, DATA_LICENCE, DATA_URL, DISCLAIMER, NOT_SUPPORTED, NOT_YET_SUPPORTED } from "./constants.js";
import { COVERAGE } from "./coverage.generated.js";
import { money, pct, renderSection, round2, sectionSources, sourceLines, tableSources, tagPageLinks, tagPageLinksDeep, uniqueSources } from "./format.js";
import {
  type CalcKind,
  checkSalary,
  describeOptions,
  endpointParams,
  enumLabel,
  type ExtraKind,
  optionParams,
  requireCalc,
  requireExtra,
  resolveEnumArg,
  supportsExtra,
  resolveCalcRegion,
  resolveCalcYear,
  resolveCountry,
  resolveOptions,
  resolveTableRegion,
  resolveTableYear,
  shortCodeOf,
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
    `Country-specific options. Examples: US {"filing_status":"mfj","children":2} (filing_status: ${COVERAGE.examples.usFilingStatus.join(" | ")}; "married" and "head_of_household" are accepted too), UK {"pension_pct":5,"student_loan":"plan2"} (student_loan: ${COVERAGE.examples.ukStudentLoan.join(" | ")}), Germany {"tax_class":3,"church":true}. Call list_countries with the country to see every option, its allowed values and its default.`,
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

/** A line's official source as the supplemental and equity endpoints return it (with the period the rule applies). */
const LineSourceSchema = SourceSchema.extend({
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().nullable().optional(),
});

const SupplementalOutput = z.object({
  country: z.string(),
  countryName: z.string(),
  region: z.string().nullable(),
  taxYear: z.string(),
  currency: z.string(),
  type: z.string().describe("Payment type: bonus, commission, rsu_vest, option_exercise or lump_sum."),
  grossSalary: z.number().describe("Regular gross salary for the year, before the payment."),
  amount: z.number().describe("The supplemental payment, gross."),
  method: z.string().describe("The official withholding method used."),
  lines: z.array(
    z.object({
      label: z.string(),
      withheld: z.number().describe("Withheld from the payment by the employer."),
      liability: z.number().nullable().describe("Extra final tax the payment adds at the person's real rates (null where it cannot be computed from official data)."),
      rate: z.number().optional(),
      note: z.string().optional(),
      source: LineSourceSchema,
    }),
  ),
  totalWithheld: z.number(),
  totalLiability: z.number().nullable(),
  difference: z.number().nullable().describe("totalLiability − totalWithheld: positive = more due at filing, negative = refund; null when unknown."),
  netPayment: z.number().describe("The payment after withholding."),
  notes: z.array(z.string()),
  inputs: z.record(z.string(), z.unknown()),
  taxTablesUrl: z.string(),
  ...CREDIT,
});

const EquityLineSchema = z.object({
  label: z.string(),
  stage: z.enum(["event", "sale"]).describe("event = vest or exercise; sale = the later sale (capital gains)."),
  base: z.number(),
  amount: z.number(),
  rate: z.number().optional(),
  withheld: z.number().optional().describe("Withheld by the employer at the event, where the country requires it."),
  note: z.string().optional(),
  source: LineSourceSchema,
});

const EquityOutput = z.object({
  country: z.string(),
  countryName: z.string(),
  region: z.string().nullable(),
  taxYear: z.string(),
  currency: z.string(),
  instrument: z.string(),
  instrumentName: z.string(),
  units: z.number(),
  taxableAtEvent: z.number().describe("Taxable amount at vest / exercise, as the country defines it."),
  lines: z.array(EquityLineSchema),
  totalTaxAtEvent: z.number(),
  totalTaxAtSale: z.number().nullable().describe("Null when no sale was given or it cannot be computed."),
  flags: z.array(z.string()).describe('E.g. "AMT exposure", "Scheme conditions assumed met".'),
  scenarios: z.array(z.object({ name: z.string(), description: z.string(), totalTax: z.number(), lines: z.array(EquityLineSchema) })),
  notes: z.array(z.string()),
  inputs: z.record(z.string(), z.unknown()),
  taxTablesUrl: z.string(),
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
  code: z.string().describe("The API key of the country (kept for compatibility)."),
  shortCode: z.string().describe("The short code to use (ISO 3166-1 alpha-2 in lower case; the UK is uk)."),
  name: z.string(),
  currency: z.string(),
  currentYear: z.string(),
  yearsAvailable: z.array(z.string()),
  takeHomePay: z.boolean(),
  employerCost: z.boolean(),
  compare: z.boolean(),
  supplementalWithholding: z.boolean().describe("calculate_supplemental_withholding works for this country."),
  equityTax: z.boolean().describe("calculate_equity_tax works for this country."),
  taxTables: z.boolean(),
  taxTablesUrl: z.string(),
});

const ExtraDetailsSchema = z
  .object({ values: z.array(z.string()).describe("Payment types or instruments."), regions: z.array(z.string()), regionRequired: z.boolean(), options: z.array(z.record(z.string(), z.unknown())) })
  .nullable();

const ListCountriesOutput = z.object({
  countries: z.array(CountrySummarySchema),
  details: z
    .object({
      code: z.string(),
      taxTableRegions: z.array(z.object({ code: z.string(), name: z.string() })),
      takeHomePay: z.object({ calculatorUrl: z.string(), salary: z.string(), regions: z.array(z.string()), options: z.array(z.record(z.string(), z.unknown())) }).nullable(),
      employerCost: z.object({ calculatorUrl: z.string(), salary: z.string(), regions: z.array(z.string()), options: z.array(z.record(z.string(), z.unknown())) }).nullable(),
      supplementalWithholding: ExtraDetailsSchema,
      equityTax: ExtraDetailsSchema,
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
      const keyHint =
        e.code === "rate_limited" && !/CALCBLOC_API_KEY/.test(e.message)
          ? ` Get a free key (email only) at ${API_KEY_URL_APP} and set it as the CALCBLOC_API_KEY environment variable of this MCP server.`
          : "";
      return fail(`CalcBloc API error [${e.code}]: ${e.message}${docs}${keyHint}`);
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

/** Official sources returned by the supplemental and equity endpoints, deduplicated and capped like the other tools. */
function resultSources(list: ResultSource[] | undefined, pageUrl: string, warnings: string[]): Source[] {
  return capSources(uniqueSources(list ?? []), pageUrl, warnings);
}

/**
 * The calcbloc.com page credited for a supplemental or equity result: the calculator page the API names (US bonus tax
 * calculator, stock option tax calculator), else the country's tax-table page rather than the generic developers page.
 */
function resultPage(attributionUrl: string | undefined, country: CountryInfo): string {
  if (attributionUrl && !/\/developers\/?(?:[?#].*)?$/.test(attributionUrl)) return attributionUrl;
  return country.endpoints["tax-tables"].pageUrl;
}

/**
 * Lines reduced to the fields the output schemas declare: MCP clients check structured content against the schema
 * with additionalProperties false, so a field the API adds later must not break the tool.
 */
function lineSource(s: ResultSource) {
  return {
    url: s.url,
    ...(s.title !== undefined ? { title: s.title } : {}),
    ...(s.retrievedAt !== undefined ? { retrievedAt: s.retrievedAt } : {}),
    ...(s.effectiveFrom !== undefined ? { effectiveFrom: s.effectiveFrom } : {}),
    ...(s.effectiveTo !== undefined ? { effectiveTo: s.effectiveTo } : {}),
  };
}

function supplementalLine(l: SupplementalLine) {
  return {
    label: l.label,
    withheld: l.withheld,
    liability: l.liability ?? null,
    ...(l.rate !== undefined ? { rate: l.rate } : {}),
    ...(l.note !== undefined ? { note: l.note } : {}),
    source: lineSource(l.source),
  };
}

function equityLine(l: EquityLine) {
  return {
    label: l.label,
    stage: l.stage,
    base: l.base,
    amount: l.amount,
    ...(l.rate !== undefined ? { rate: l.rate } : {}),
    ...(l.withheld !== undefined ? { withheld: l.withheld } : {}),
    ...(l.note !== undefined ? { note: l.note } : {}),
    source: lineSource(l.source),
  };
}

function placeOf(country: CountryInfo, kind: ExtraKind, region: string | null | undefined): string {
  if (!region) return country.name;
  const label = enumLabel(country, kind, "region", region);
  return `${country.name} (${label !== region ? label : regionName(country, region)})`;
}

export interface SupplementalArgs {
  country: string;
  gross_salary: number;
  amount: number;
  type?: string;
  region?: string;
  options?: Record<string, string | number | boolean>;
}

export async function supplementalWithholding(client: CalcBlocClient, args: SupplementalArgs): Promise<ToolResult> {
  return guarded(async () => {
    const kind = "supplemental-withholding" as const;
    const countries = await onlineCountries(client);
    const country = resolveCountry(countries, args.country);
    requireExtra(countries, country, kind);
    checkSalary(country, kind, args.gross_salary);
    const type = resolveEnumArg(country, kind, "type", "Payment type", args.type);
    const warnings: string[] = [];
    const { region, warning } = resolveCalcRegion(country, kind, args.region);
    if (warning) warnings.push(warning);
    const options = resolveOptions(country, kind, args.options);
    const query: Record<string, QueryValue> = {
      country: country.code,
      salary: args.gross_salary,
      amount: args.amount,
      ...(type ? { type } : {}),
      ...(region ? { region } : {}),
      ...options,
    };
    const r = await client.supplementalWithholding(query);
    warnings.push(...(r.warnings ?? []));
    const taxTablesUrl = country.endpoints["tax-tables"].pageUrl;
    const pageUrl = resultPage(r.attribution?.url, country);
    const sources = resultSources(r.sources, pageUrl, warnings);
    const s = r.summary;
    const cur = r.currency;
    const gap =
      s.difference === null || s.difference === undefined
        ? "the final tax could not be computed for every line (see the lines and notes)"
        : s.difference > 0
          ? `${money(s.difference, cur)} more than is withheld, settled after the year`
          : s.difference < 0
            ? `${money(-s.difference, cur)} less than is withheld, refunded after the year`
            : "the same as the withholding";
    const lines = [
      `Supplemental withholding in ${placeOf(country, kind, r.region)}, tax year ${r.year}`,
      `Payment: ${money(s.amount, cur)} (${enumLabel(country, kind, "type", r.type)}) on a regular gross salary of ${money(args.gross_salary, cur)} a year`,
      `Method: ${r.method}`,
      `Withheld from the payment: ${money(s.totalWithheld, cur)}; net payment: ${money(s.netPayment, cur)}`,
      `Final tax the payment adds: ${money(s.totalLiability, cur)} (${gap})`,
      "",
      `Lines (withheld | final tax added, ${cur}):`,
      ...r.lines.map((l) => `- ${l.label}: ${money(l.withheld, cur)} | ${l.liability === null ? "n/a" : money(l.liability, cur)}${l.note ? ` (${l.note})` : ""}`),
    ];
    if (r.notes.length) lines.push("", "Notes:", ...r.notes.map((n) => `- ${n}`));
    lines.push("", `Inputs used: ${inputsLine(r.inputs)}`, `Page: ${pageUrl}`, `Tax tables: ${taxTablesUrl}`);
    lines.push(...creditFooter(sources, pageUrl, warnings));
    return ok(lines.join("\n"), {
      country: r.country,
      countryName: r.countryName,
      region: r.region ?? null,
      taxYear: r.year,
      currency: cur,
      type: r.type,
      grossSalary: args.gross_salary,
      amount: s.amount,
      method: r.method,
      lines: r.lines.map(supplementalLine),
      totalWithheld: s.totalWithheld,
      totalLiability: s.totalLiability ?? null,
      difference: s.difference ?? null,
      netPayment: s.netPayment,
      notes: r.notes,
      inputs: r.inputs,
      taxTablesUrl,
      ...creditFields(sources, pageUrl, warnings),
    });
  });
}

export interface EquityArgs {
  country: string;
  instrument: string;
  units: number;
  grant_date: string;
  event_date: string;
  fmv_event: number;
  gross_salary: number;
  fmv_grant?: number;
  exercise_price?: number;
  sale_price?: number;
  sale_date?: string;
  region?: string;
  options?: Record<string, string | number | boolean>;
}

/** What the taxing event is called for an instrument. */
function eventWord(instrument: string): string {
  if (instrument === "rsu") return "vest";
  if (instrument.startsWith("ess_")) return "taxing point";
  return "exercise";
}

export async function equityTax(client: CalcBlocClient, args: EquityArgs): Promise<ToolResult> {
  return guarded(async () => {
    const kind = "equity-tax" as const;
    const countries = await onlineCountries(client);
    const country = resolveCountry(countries, args.country);
    requireExtra(countries, country, kind);
    const instrument = resolveEnumArg(country, kind, "instrument", "Instrument", args.instrument);
    if (!instrument) throw new ToolInputError(`instrument is required for ${country.name}: one of ${country.equity_tax?.instruments.join(", ")}.`);
    checkSalary(country, kind, args.gross_salary);
    if ((args.sale_price === undefined) !== (args.sale_date === undefined)) throw new ToolInputError("sale_price and sale_date go together: give both for the tax on a sale, or neither.");
    if (args.event_date < args.grant_date) throw new ToolInputError(`event_date (${args.event_date}) cannot be before grant_date (${args.grant_date}).`);
    if (args.sale_date && args.sale_date < args.event_date) throw new ToolInputError(`sale_date (${args.sale_date}) cannot be before event_date (${args.event_date}).`);
    const warnings: string[] = [];
    const { region, warning } = resolveCalcRegion(country, kind, args.region);
    if (warning) warnings.push(warning);
    const options = resolveOptions(country, kind, args.options);
    const optional: Record<string, QueryValue | undefined> = { fmv_grant: args.fmv_grant, exercise_price: args.exercise_price, sale_price: args.sale_price, sale_date: args.sale_date };
    const query: Record<string, QueryValue> = {
      country: country.code,
      instrument,
      units: args.units,
      grant_date: args.grant_date,
      event_date: args.event_date,
      fmv_event: args.fmv_event,
      salary: args.gross_salary,
      ...Object.fromEntries(Object.entries(optional).filter((e): e is [string, QueryValue] => e[1] !== undefined)),
      ...(region ? { region } : {}),
      ...options,
    };
    const r = await client.equityTax(query);
    const x = r.result;
    warnings.push(...(r.warnings ?? []));
    const taxTablesUrl = country.endpoints["tax-tables"].pageUrl;
    const pageUrl = resultPage(r.attribution?.url, country);
    const sources = resultSources(x.sources, pageUrl, warnings);
    const cur = x.currency;
    const instrumentName = enumLabel(country, kind, "instrument", x.instrument);
    const when = eventWord(x.instrument);
    const lineText = (l: EquityLine) =>
      `- ${l.label}: ${money(l.amount, cur)} on ${money(l.base, cur)}${l.rate !== undefined ? ` at ${pct(l.rate)}` : ""}${l.withheld !== undefined ? ` (withheld ${money(l.withheld, cur)})` : ""}${l.note ? `. ${l.note}` : ""}`;
    const atEvent = x.lines.filter((l) => l.stage === "event");
    const atSale = x.lines.filter((l) => l.stage === "sale");
    const lines = [
      `Equity tax in ${placeOf(country, kind, x.region)}, tax year ${x.taxYear}`,
      `Instrument: ${instrumentName}, ${x.units.toLocaleString("en-US")} units; taxable at ${when}: ${money(x.taxableAtEvent, cur)}`,
    ];
    if (atEvent.length) lines.push("", `At ${when} (${args.event_date}):`, ...atEvent.map(lineText));
    if (atSale.length) lines.push("", `At sale (${args.sale_date ?? "sale"}):`, ...atSale.map(lineText));
    lines.push("", `Total tax at ${when}: ${money(x.totalTaxAtEvent, cur)}`);
    lines.push(`Total tax at sale: ${x.totalTaxAtSale === null ? (args.sale_date ? "not computed (see notes)" : "n/a (no sale given)") : money(x.totalTaxAtSale, cur)}`);
    if (x.flags.length) lines.push(`Flags: ${x.flags.join("; ")}`);
    if (x.scenarios.length) lines.push("", "Scenarios:", ...x.scenarios.map((sc) => `- ${sc.name}: ${sc.description} Total tax: ${money(sc.totalTax, cur)}.`));
    if (x.notes.length) lines.push("", "Notes:", ...x.notes.map((n) => `- ${n}`));
    lines.push("", `Inputs used: ${inputsLine(r.inputs)}`, `Page: ${pageUrl}`, `Tax tables: ${taxTablesUrl}`);
    lines.push(...creditFooter(sources, pageUrl, warnings));
    return ok(lines.join("\n"), {
      country: r.country,
      countryName: r.countryName,
      region: x.region ?? null,
      taxYear: x.taxYear,
      currency: cur,
      instrument: x.instrument,
      instrumentName,
      units: x.units,
      taxableAtEvent: x.taxableAtEvent,
      lines: x.lines.map(equityLine),
      totalTaxAtEvent: x.totalTaxAtEvent,
      totalTaxAtSale: x.totalTaxAtSale ?? null,
      flags: x.flags,
      scenarios: x.scenarios.map((sc) => ({ name: sc.name, description: sc.description, totalTax: sc.totalTax, lines: sc.lines.map(equityLine) })),
      notes: x.notes,
      inputs: r.inputs,
      taxTablesUrl,
      ...creditFields(sources, pageUrl, warnings),
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
      shortCode: shortCodeOf(c),
      name: c.name,
      currency: c.currency,
      currentYear: c.current_year,
      yearsAvailable: c.years_available,
      takeHomePay: !!c.endpoints["net-salary"],
      employerCost: !!c.endpoints["employer-cost"],
      compare: c.available_endpoints.includes("compare"),
      supplementalWithholding: supportsExtra(c, "supplemental-withholding"),
      equityTax: supportsExtra(c, "equity-tax"),
      taxTables: true,
      taxTablesUrl: c.endpoints["tax-tables"].pageUrl,
    }));
    const pageUrl = "https://calcbloc.com/developers";
    const warnings: string[] = [];
    if (!args.country) {
      const calc = summary.filter((c) => c.takeHomePay);
      const lines = [
        `CalcBloc covers ${summary.length} countries. Tax tables are available for all of them; take-home pay calculations for ${calc.length}, employer cost for ${summary.filter((c) => c.employerCost).length}, compare for ${summary.filter((c) => c.compare).length}, supplemental (bonus) withholding for ${summary.filter((c) => c.supplementalWithholding).length}, equity tax (RSUs, stock options) for ${summary.filter((c) => c.equityTax).length}. Use the code shown (older keys such as new-zealand also work).`,
        "",
        ...summary.map((c) => {
          const what = [
            c.takeHomePay && "take-home pay",
            c.employerCost && "employer cost",
            c.compare && "compare",
            c.supplementalWithholding && "supplemental withholding",
            c.equityTax && "equity tax",
            "tax tables",
          ]
            .filter(Boolean)
            .join(", ");
          return `- ${c.shortCode}: ${c.name} (${c.currency}), tax year ${c.currentYear}${c.yearsAvailable.length > 1 ? ` (tables also ${c.yearsAvailable.slice(1).join(", ")})` : ""}: ${what}`;
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
    const extra = (kind: ExtraKind) => {
      const params = endpointParams(c, kind);
      if (!params) return null;
      const rp = params.find((p) => p.name === "region");
      const values = kind === "equity-tax" ? (c.equity_tax?.instruments ?? []) : (c.endpoints["supplemental-withholding"]?.types ?? []);
      return { values, regions: rp?.values ?? [], regionRequired: !!rp?.required, options: optionParams(c, kind) as unknown as Record<string, unknown>[] };
    };
    const details = {
      code: c.code,
      taxTableRegions: c.endpoints["tax-tables"].regions,
      takeHomePay: calc("net-salary"),
      employerCost: calc("employer-cost"),
      supplementalWithholding: extra("supplemental-withholding"),
      equityTax: extra("equity-tax"),
    };
    const lines = [`${c.name} (${shortCodeOf(c)}), currency ${c.currency}, current tax year ${c.current_year}; tax-table years: ${c.years_available.join(", ")}.`, `Tax tables: ${c.endpoints["tax-tables"].pageUrl}`];
    lines.push(details.taxTableRegions.length ? `Regional tax tables: ${details.taxTableRegions.map((r) => `${r.code} (${r.name})`).join(", ")}` : "No regional tax tables.");
    for (const [label, kind, d] of [["Take-home pay", "net-salary", details.takeHomePay], ["Employer cost", "employer-cost", details.employerCost]] as const) {
      if (!d) {
        lines.push("", `${label}: not available yet (tax tables only).`);
        continue;
      }
      lines.push("", `${label} (${d.calculatorUrl}):`, `- gross_salary: ${d.salary}`);
      const rp = c.endpoints[kind]?.parameters.find((p) => p.name === "region");
      if (d.regions.length) lines.push(`- region${rp?.required ? " (REQUIRED)" : ""}: ${d.regions.map((r) => (rp?.labels?.[r] ? `${r} (${rp.labels[r]})` : r)).join(", ")}`);
      lines.push(`- options: ${describeOptions(c, kind)}`);
    }
    for (const [label, kind, d, what] of [
      ["Supplemental withholding (calculate_supplemental_withholding)", "supplemental-withholding", details.supplementalWithholding, "type"],
      ["Equity tax (calculate_equity_tax)", "equity-tax", details.equityTax, "instrument"],
    ] as const) {
      if (!d) {
        lines.push("", `${label}: not available for ${c.name} yet.`);
        continue;
      }
      lines.push("", `${label}:`, `- ${what}: ${d.values.map((v) => { const l = enumLabel(c, kind, what, v); return l !== v ? `${v} (${l})` : v; }).join(", ")}`);
      const rp = endpointParams(c, kind)?.find((p) => p.name === "region");
      if (d.regions.length) lines.push(`- region${d.regionRequired ? " (REQUIRED)" : ""}: ${d.regions.map((r) => (rp?.labels?.[r] ? `${r} (${rp.labels[r]})` : r)).join(", ")}`);
      lines.push(`- options: ${describeOptions(c, kind)}`);
    }
    lines.push("", `${ATTRIBUTION}: ${pageUrl}`);
    return ok(lines.join("\n"), { countries: summary.filter((s) => s.code === c.code), details, ...creditFields([], c.endpoints["tax-tables"].pageUrl, warnings) });
  });
}

/* ------------------------------------------------------------------ registration ------------------------------------------------------------- */

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const countryArg = z
  .string()
  .min(2)
  .max(60)
  .describe('Country short code (ISO 3166-1 alpha-2 in lower case; the UK is "uk", "gb" also works), e.g. "us", "uk", "ca", "de", "in", "au", "nz", or the English name. Older keys such as "new-zealand" also work. See list_countries.');
const salaryArg = z
  .number()
  .positive()
  .max(10_000_000)
  .describe("Gross salary before tax in the country's currency. Annual for every country except Singapore (monthly); India: annual CTC/gross as described by list_countries.");
const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

/** Countries whose supplemental payment types are a subset of all types, e.g. "au: bonus, commission, lump_sum". */
function typeLimits(): string {
  const all = COVERAGE.supplementalTypeValues as readonly string[];
  const limited = Object.entries(COVERAGE.supplementalTypes as Record<string, readonly string[]>).filter(([, t]) => t.length < all.length);
  return limited.length ? `Types are limited for ${limited.map(([c, t]) => `${c} (${t.join(", ")})`).join(", ")}; other countries take every type. ` : "";
}

/** "us (rsu, nso, iso), uk (rsu, emi, csop, unapproved_option), …" from the generated coverage. */
function instrumentList(): string {
  return Object.entries(COVERAGE.equityInstruments as Record<string, readonly string[]>)
    .map(([c, list]) => `${c} (${list.join(", ")})`)
    .join(", ");
}

const yearArg = z.string().max(10).optional().describe('Tax year, e.g. "2026" or "2026-27". Default: the current year. Calculations use the current year only.');

export function registerTools(server: McpServer, client: CalcBlocClient): void {
  server.registerTool(
    "calculate_take_home_pay",
    {
      title: "Calculate take-home pay",
      description:
        `Net (take-home) pay after income tax and employee social security for a gross salary, with a line-by-line breakdown, using official rates for the current tax year. Countries: ${COVERAGE.netSalaryCountries.join(", ")} (${COVERAGE.summary}) region is REQUIRED for: ${COVERAGE.regionRequired["net-salary"].join(", ")}; optional for: ${COVERAGE.regionOptional["net-salary"].join(", ")}; a missing or unknown region returns the valid codes. Returns the tax year, official source URLs and the calcbloc.com page. ${NOT_SUPPORTED}`,
      inputSchema: z.object({
        country: countryArg,
        gross_salary: salaryArg,
        region: z
          .string()
          .max(60)
          .optional()
          .describe(`Region code or name. Required for: ${COVERAGE.regionRequired["net-salary"].join(", ")}. Examples: US "ca" or "California", UK "scotland", Canada "on", Spain "md", Germany "by". list_countries with the country lists every code.`),
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
        `Total cost of employing someone on a gross salary: the salary plus employer social security, payroll taxes, pension and other on-costs, with a breakdown, for the current tax year. Countries: ${COVERAGE.employerCostCountries.join(", ")}. region is REQUIRED for: ${COVERAGE.regionRequired["employer-cost"].join(", ")}; optional for: ${COVERAGE.regionOptional["employer-cost"].join(", ")}; a missing or unknown region returns the valid codes. Returns the tax year, official source URLs and the calcbloc.com page. ${NOT_SUPPORTED}`,
      inputSchema: z.object({
        country: countryArg,
        gross_salary: salaryArg,
        region: z
          .string()
          .max(60)
          .optional()
          .describe(`Region code or name. Required for: ${COVERAGE.regionRequired["employer-cost"].join(", ")}. Examples: US "ca", Australia "nsw", Canada "on". list_countries with the country lists every code.`),
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
        `The same gross salary in two countries: take-home pay, income tax and contributions on each side, converted at the European Central Bank reference rate, with a plain-English summary. Countries: ${COVERAGE.compareCountries.join(", ")}. Use region_a / region_b for a US state, UK nation, Canadian province or Indian state (defaults apply otherwise and are stated in the answer). Returns each side's tax year and official sources. ${NOT_SUPPORTED}`,
      inputSchema: z.object({
        country_a: countryArg,
        country_b: countryArg,
        gross_salary: z.number().positive().max(10_000_000).describe("Annual gross salary, in `currency`."),
        currency: z.string().length(3).optional().describe("Currency of gross_salary: country A's or country B's (ISO code). Default: country A's."),
        region_a: z.string().max(60).optional().describe('Region in country A: a US state ("ca"), UK nation ("scotland"), Canadian province ("on") or Indian state ("mh"). Defaults: New York, England, Ontario, Maharashtra.'),
        region_b: z.string().max(60).optional().describe('Region in country B: a US state ("ca"), UK nation ("scotland"), Canadian province ("on") or Indian state ("mh"). Defaults: New York, England, Ontario, Maharashtra.'),
      }),
      outputSchema: CompareOutput,
      annotations: { ...READ_ONLY },
    },
    async (args) => compareCountries(client, args),
  );

  server.registerTool(
    "calculate_supplemental_withholding",
    {
      title: "Calculate withholding on a bonus or other supplemental pay",
      description:
        `Tax withheld on a supplemental payment (bonus, commission, RSU vest, stock option exercise or lump sum) paid on top of a regular salary, using the country's official withholding method (for example the IRS supplemental flat rate, HMRC cumulative PAYE, the CRA bonus method), line by line, next to the final tax the payment adds at the person's real rates, so over- or under-withholding shows. Countries: ${COVERAGE.supplementalCountries.join(", ")}. ${typeLimits()}region is REQUIRED for: ${COVERAGE.regionRequiredExtra["supplemental-withholding"].join(", ")}; optional for: ${COVERAGE.regionOptionalExtra["supplemental-withholding"].join(", ")}; a missing or unknown region returns the valid codes. Other countries return the list of supported ones. Returns the tax year, the method, official source URLs and the calcbloc.com page. ${NOT_YET_SUPPORTED}`,
      inputSchema: z.object({
        country: countryArg,
        gross_salary: z
          .number()
          .positive()
          .max(1_000_000_000)
          .describe("Regular gross salary for the year, before the supplemental payment, in the country's currency (annual in every country)."),
        amount: z.number().positive().max(1_000_000_000).describe("The supplemental payment (gross), in the country's currency."),
        type: z
          .enum(COVERAGE.supplementalTypeValues)
          .optional()
          .describe(`Kind of payment. Default: bonus. ${typeLimits()}`.trim()),
        region: z
          .string()
          .max(60)
          .optional()
          .describe(`Region code or name. Required for: ${COVERAGE.regionRequiredExtra["supplemental-withholding"].join(", ")}; optional for: ${COVERAGE.regionOptionalExtra["supplemental-withholding"].join(", ")}. Examples: US "ca" or "California", Canada "on", UK "scotland". list_countries with the country lists every code.`),
        options: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe(
            `Country-specific options. Examples: US {"filing_status":"mfj","method":"aggregate","ytd_supplemental":900000} (filing_status: ${COVERAGE.examples.usSupplementalFilingStatus.join(" | ")}; method: ${COVERAGE.examples.usSupplementalMethod.join(" | ")}), UK {"tax_code_number":1257,"month_paid":12}, Germany {"tax_class":3,"church":true}. Call list_countries with the country to see every option, its allowed values and its default.`,
          ),
      }),
      outputSchema: SupplementalOutput,
      annotations: { ...READ_ONLY },
    },
    async (args) => supplementalWithholding(client, args),
  );

  server.registerTool(
    "calculate_equity_tax",
    {
      title: "Calculate tax on RSUs and stock options",
      description:
        `Tax on equity compensation: income tax, social security and employer withholding when RSUs vest or stock options are exercised, and capital gains tax on a later sale (give sale_price and sale_date), with flags (such as AMT exposure) and the alternative outcomes the law allows (such as qualifying vs disqualifying disposition). Countries and instruments: ${instrumentList()}. Required: country, instrument, units, grant_date, event_date, fmv_event, gross_salary; options also need exercise_price. region is REQUIRED for: ${COVERAGE.regionRequiredExtra["equity-tax"].join(", ")}; optional for: ${COVERAGE.regionOptionalExtra["equity-tax"].join(", ")}. Other countries return the list of supported ones. Returns the tax year, official source URLs and the calcbloc.com page. ${NOT_YET_SUPPORTED}`,
      inputSchema: z.object({
        country: countryArg,
        instrument: z.enum(COVERAGE.equityInstrumentValues).describe(`Equity instrument; each country has its own: ${instrumentList()}.`),
        units: z.number().positive().max(1_000_000_000).describe("Number of shares vesting or options exercised."),
        grant_date: dateArg.describe("Grant date (YYYY-MM-DD)."),
        event_date: dateArg.describe("Vest date (RSUs), exercise date (options), or the acquisition or deferred taxing point (Australia ESS) (YYYY-MM-DD)."),
        fmv_event: z.number().min(0).max(1_000_000_000).describe("Market value per share at vest or exercise, in the country's currency (India: FMV under rule 15(6))."),
        gross_salary: z.number().min(0).max(1_000_000_000).describe("Regular annual gross salary in the country's currency (for the marginal rates and contribution ceilings)."),
        exercise_price: z.number().min(0).max(1_000_000_000).optional().describe("Exercise price per share (required for options; RSUs: any amount paid, default 0)."),
        fmv_grant: z.number().min(0).max(1_000_000_000).optional().describe("Market value per share at grant (UK EMI discount and CSOP limit, Canada 110(1)(d) and the vesting limit)."),
        sale_price: z.number().min(0).max(1_000_000_000).optional().describe("Sale price per share; with sale_date it adds the tax on the sale."),
        sale_date: dateArg.optional().describe("Sale date (YYYY-MM-DD), with sale_price."),
        region: z
          .string()
          .max(60)
          .optional()
          .describe(`Region code or name. Required for: ${COVERAGE.regionRequiredExtra["equity-tax"].join(", ")}; optional for: ${COVERAGE.regionOptionalExtra["equity-tax"].join(", ")}. Examples: Canada "on" or "Ontario", US "ca" (state withholding; omit for federal only), UK "scotland".`),
        options: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe(
            `Country-specific options. Examples: US {"filing_status":"mfj"}, UK {"readily_convertible":false,"emi_exercise_period_years":"10"}, Canada {"employer_type":"ccpc"}, India {"regime":"old","listed":true}. Call list_countries with the country to see every option, its allowed values and its default.`,
          ),
      }),
      outputSchema: EquityOutput,
      annotations: { ...READ_ONLY },
    },
    async (args) => equityTax(client, args),
  );

  server.registerTool(
    "get_tax_tables",
    {
      title: "Get official tax tables",
      description:
        `Official tax tables for a country and year: income tax bands, allowances, employee and employer social security rates and thresholds, and for many countries corporate, property, transfer and other taxes, each with its official source and the date it was checked. Available for all ${COVERAGE.taxTables} countries, including those without calculations. Filter with group or sections for long tables.`,
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
        `Countries CalcBloc covers (${COVERAGE.summary}), their current tax year, and which tools work for each. With a country, also its regions (and whether they are required) and the country-specific options accepted by calculate_take_home_pay and calculate_employer_cost.`,
      inputSchema: z.object({ country: z.string().max(60).optional().describe("Country code or name for details.") }),
      outputSchema: ListCountriesOutput,
      annotations: { ...READ_ONLY },
    },
    async (args) => listCountries(client, args),
  );
}

