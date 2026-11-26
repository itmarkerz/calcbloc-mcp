import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  CalcBlocApiError,
  type CalcBlocClient,
  type CalcResponse,
  type CalendarSource,
  type CompareSide,
  type CountryInfo,
  type CrossBorderCountry,
  type EquityLine,
  type ImportDutyResponse,
  type QueryValue,
  type ResultSource,
  type Source,
  type SupplementalLine,
  type TariffLine,
  type TariffMeta,
  type TaxCalendar,
  type TaxFact,
  type TaxTable,
  type TradeAgreement,
  type TradeMeasure,
} from "./api.js";
import { API_KEY_URL_APP, ATTRIBUTION, DATA_LICENCE, DATA_URL, DEVELOPERS_URL, DISCLAIMER, NOT_SUPPORTED, NOT_YET_SUPPORTED } from "./constants.js";
import { COVERAGE } from "./coverage.generated.js";
import { money, pct, renderSection, round2, sectionSources, sourceLines, tableSources, tagPageLinks, tagPageLinksDeep, uniqueSources } from "./format.js";
import {
  type CalcKind,
  checkSalary,
  normalizeYear,
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

/* ------------------------------------------------- API 1.9 schemas: cross-border equity, trade, calendar, facts ------------------------------------------------- */

const CrossBorderOutput = z.object({
  estimate: z.literal(true).describe("Always true: every cross-border result is an estimate."),
  label: z.string(),
  instrument: z.string(),
  units: z.number(),
  currency: z.string().describe("Currency of fmv_event, exercise_price and totalIncome."),
  totalIncome: z.number().describe("Income at the event (vest value, or the option spread)."),
  sourcingPeriod: z.object({ start: z.string(), end: z.string(), weekdays: z.number() }),
  eventDate: z.string(),
  residence: z.object({ country: z.string(), how: z.string() }),
  grantCountry: z.object({ country: z.string(), how: z.string() }),
  totalWorkdays: z.number(),
  periods: z.array(z.object({ country: z.string(), start: z.string(), end: z.string(), workdaysGiven: z.number().nullable(), workdaysUsed: z.number(), computed: z.boolean(), clipped: z.boolean() })),
  countries: z.array(
    z.object({
      country: z.string(),
      countryName: z.string(),
      covered: z.boolean().describe("False: the split is shown but CalcBloc has no tax estimate for this country."),
      currency: z.string(),
      workdays: z.number(),
      workdayShare: z.number(),
      method: z.string(),
      methodLabel: z.string(),
      oecdDefault: z.boolean(),
      ruleStatus: z.string(),
      basis: z.string(),
      taxableShare: z.number(),
      taxableAmount: z.number().describe("In `currency`."),
      taxableAmountLocal: z.number().describe("In the country's currency (ECB reference rate)."),
      isResidence: z.boolean(),
      estimate: z
        .object({
          engine: z.string(),
          instrument: z.string(),
          method: z.string(),
          taxYear: z.string(),
          taxableAmount: z.number(),
          estimatedTax: z.number(),
          withheld: z.number().nullable(),
          lines: z.array(z.object({ label: z.string(), amount: z.number(), withheld: z.number().optional(), rate: z.number().optional(), note: z.string().optional() })),
          notes: z.array(z.string()),
        })
        .nullable(),
      notes: z.array(z.string()),
    }),
  ),
  relief: z.array(z.object({ source: z.string(), other: z.string(), overlap: z.number(), kind: z.string(), treaty: z.string(), text: z.string() })).describe("Where two countries tax the same income; the relief itself is not computed."),
  flags: z.array(z.string()),
  notes: z.array(z.string()),
  underReview: z.array(z.string()),
  fx: z.object({ referenceDate: z.string(), rates: z.record(z.string(), z.number()) }),
  inputs: z.record(z.string(), z.unknown()),
  ...CREDIT,
});

const TariffSchema = z.object({
  destination: z.string(),
  nomenclature: z.string(),
  version: z.string(),
  asOf: z.string(),
  publisher: z.string(),
  source: z.string(),
  licence: z.string(),
});

const MeasureSchema = z.object({
  measureType: z.string(),
  type: z.string(),
  area: z.string(),
  agreement: z.string().optional(),
  additionalCode: z.string().optional(),
  quota: z.string().optional(),
  duty: z.string().describe("The duty in plain words (e.g. 6%, Free, a specific duty per unit)."),
  dutyText: z.string().describe("The duty exactly as the tariff states it."),
  conditional: z.boolean().optional().describe("True when the tariff sets conditions (documents, end use)."),
  legalAct: z.string().optional(),
  validFrom: z.string(),
  validTo: z.string().nullable(),
});

const MeasureGroupSchema = z.object({
  type: z.string(),
  extraType: z.string().nullable(),
  area: z.string(),
  duty: z.string(),
  legalAct: z.string().optional(),
  count: z.number().describe("Measures in the group (one per exporter additional code, for example)."),
  additionalCodes: z.array(z.string()).describe("The first additional codes of the group."),
});

const TradeCredit = { ...CREDIT, caveat: z.string().describe("The tariff figures are not a customs ruling; who makes the final determination.") };

const ImportDutyOutput = z.object({
  destination: z.string(),
  memberState: z.object({ code: z.string(), name: z.string() }).nullable(),
  origin: z.object({ iso: z.string(), name: z.string() }),
  tariff: TariffSchema,
  commodity: z.object({ code: z.string(), description: z.string(), path: z.array(z.string()), supplementaryUnit: z.string().nullable() }),
  currency: z.string(),
  customsValue: z.number(),
  lines: z.array(
    z.object({
      kind: z.string().describe("customs_duty, extra_duty, excise, import_vat or fee."),
      label: z.string(),
      measure: MeasureSchema.nullable(),
      base: z.number().nullable(),
      baseDescription: z.string(),
      amount: z.number().nullable().describe("Null when it cannot be computed from the inputs (see notComputed)."),
      notComputed: z.string().nullable(),
      source: z.string(),
    }),
  ),
  totals: z.object({
    customsDuty: z.number().nullable(),
    extraDuties: z.number().nullable(),
    excise: z.number().nullable(),
    importVat: z.number().nullable(),
    fees: z.number().nullable(),
    dutiesAndTaxes: z.number().nullable(),
    landedCost: z.number().nullable(),
    complete: z.boolean().describe("False when a duty or tax could not be computed or is not covered; see incompleteReasons."),
    incompleteReasons: z.array(z.string()),
  }),
  mfn: z.object({ duty: z.string(), dutyText: z.string(), amount: z.number().nullable() }),
  preferential: MeasureSchema.nullable().describe("The preference applied (proof_of_origin true), or the best one available."),
  preferentialOptions: z.array(MeasureSchema),
  extraDutiesPossible: z.array(MeasureGroupSchema).describe("Extra duties that apply to some imports of this origin (e.g. per exporter additional code)."),
  otherCharges: z.array(MeasureSchema).describe("Listed, not added to the totals."),
  notes: z.array(z.string()),
  basis: z.record(z.string(), z.object({ rule: z.string(), source: z.string() })),
  tariffDisclaimer: z.string(),
  inputs: z.record(z.string(), z.unknown()),
  ...TradeCredit,
});

const TariffLineSchema = z.object({
  code: z.string(),
  description: z.string(),
  path: z.array(z.string()),
  supplementaryUnit: z.string().nullable(),
  mfn: z.object({ duty: z.string(), dutyText: z.string() }),
  thirdCountry: z.array(MeasureSchema),
  bestPreferential: MeasureSchema.nullable().describe("With origin: the lowest preference that needs no quota or licence."),
  preferential: z.array(MeasureSchema).describe("With origin: the preferences for that origin."),
  preferentialByDuty: z.array(z.object({ duty: z.string(), agreements: z.array(z.string()) })).describe("Without origin: every preference, grouped by duty."),
  preferentialCount: z.number(),
  suspensions: z.array(MeasureSchema),
  quotas: z.array(MeasureSchema),
  extraDuties: z.array(MeasureGroupSchema),
  surcharges: z.array(MeasureSchema),
  importVat: z.array(MeasureSchema),
  excise: z.array(MeasureSchema),
  otherCharges: z.array(MeasureSchema),
  notes: z.array(z.string()),
  source: z.string(),
  page: z.string().describe("The official tariff page of the code."),
});

const TariffOutput = z.object({
  tariff: TariffSchema,
  origin: z.object({ iso: z.string(), name: z.string() }).nullable(),
  code: z.string(),
  total: z.number().describe("Tariff lines under the code."),
  count: z.number(),
  nextCursor: z.string().nullable().describe("Pass as cursor for the next lines; null on the last page."),
  lines: z.array(TariffLineSchema),
  ...TradeCredit,
});

const AgreementSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  parties: z.array(z.string()),
  signed: z.string().nullable(),
  inForce: z.string().nullable(),
  origins: z.array(z.string()).describe("Origin countries the tariff gives the preference to (first 40)."),
  originCount: z.number(),
  rulesOfOrigin: z.string().optional().describe("With partner or agreement: the rules of origin."),
  links: z.array(z.object({ text: z.string(), url: z.string() })).optional(),
});

const AgreementsOutput = z.object({
  tariff: TariffSchema,
  partner: z.object({ iso: z.string(), name: z.string() }).nullable(),
  count: z.number(),
  agreements: z.array(AgreementSchema),
  ...TradeCredit,
});

const CalSourceSchema = z.object({ title: z.string(), url: z.string(), retrievedAt: z.string() });

const CalendarDetailSchema = z.object({
  country: z.string(),
  countryName: z.string(),
  region: z.object({ code: z.string(), name: z.string() }).nullable(),
  taxYear: z.object({ label: z.string(), displayLabel: z.string(), start: z.string(), end: z.string(), type: z.string(), daysRemaining: z.number(), dataYear: z.string().nullable() }),
  nextTaxYear: z.object({ label: z.string(), displayLabel: z.string(), start: z.string(), end: z.string() }).nullable(),
  otherPeriods: z.array(z.object({ tax: z.string(), label: z.string(), start: z.string(), end: z.string(), source: CalSourceSchema })),
  upcomingChanges: z.array(
    z.object({
      id: z.string(),
      effectiveFrom: z.string(),
      datePrecision: z.string().describe("day, month or year: how precisely the official page gives the date."),
      effectiveTo: z.string().nullable(),
      title: z.string(),
      detail: z.string().nullable(),
      tax: z.string(),
      region: z.object({ code: z.string(), name: z.string() }).nullable(),
      status: z.string().describe("enacted (in law or final) or announced (budget, bill or decision, not yet law)."),
      source: CalSourceSchema,
      quote: z.string().nullable(),
    }),
  ),
  window: z.object({ from: z.string(), to: z.string() }),
  nextBudget: z.object({ status: z.string().describe("scheduled only when the government has announced the date; otherwise not_announced."), event: z.string().nullable(), date: z.string().nullable() }),
  lastBudget: z.object({ event: z.string(), date: z.string() }).nullable(),
  nextYearNote: z.string().nullable(),
  pageUrl: z.string(),
});

const CalendarSummarySchema = z.object({
  country: z.string(),
  shortCode: z.string(),
  name: z.string(),
  taxYear: z.string(),
  start: z.string(),
  end: z.string(),
  type: z.string(),
  daysRemaining: z.number(),
  nextTaxYearStart: z.string().nullable(),
  upcomingChanges: z.number(),
  nextChange: z.object({ effectiveFrom: z.string(), title: z.string(), status: z.string() }).nullable(),
  nextBudget: z.string(),
});

const TaxCalendarOutput = z.object({
  asOf: z.string().nullable(),
  calendar: CalendarDetailSchema.nullable().describe("With country: its calendar."),
  countries: z.array(CalendarSummarySchema).nullable().describe("Without country: one line per country."),
  ...CREDIT,
});

const FactSchema = z.object({
  id: z.string(),
  country: z.string(),
  jurisdiction: z.string(),
  level: z.string(),
  taxType: z.string(),
  label: z.string(),
  section: z.string().nullable(),
  measure: z.string(),
  value: z.union([z.number(), z.string()]).nullable().describe("Rates are decimals (0.2 = 20%)."),
  bands: z.array(z.object({ label: z.string().optional(), from: z.number(), to: z.number().nullable(), rate: z.number() })).nullable(),
  unit: z.string().nullable(),
  currency: z.string().nullable(),
  basis: z.string().nullable(),
  note: z.string().nullable(),
  appliesWhen: z.string().nullable(),
  taxYear: z.string(),
  validFrom: z.string(),
  validTo: z.string().nullable(),
  status: z.string(),
  source: SourceSchema,
});

const FactsOutput = z.object({
  filters: z.record(z.string(), z.string()),
  total: z.number(),
  count: z.number(),
  nextCursor: z.string().nullable().describe("Pass as cursor for the next facts; null on the last page."),
  facts: z.array(FactSchema),
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

/* ----------------------------------------------------------- API 1.9: cross-border equity ----------------------------------------------------------- */

export interface CrossBorderArgs {
  instrument: string;
  units: number;
  grant_date: string;
  vest_date?: string;
  event_date: string;
  fmv_event: number;
  exercise_price?: number;
  currency?: string;
  periods: { country: string; start: string; end: string; workdays?: number }[];
  salaries?: Record<string, number>;
  options?: Record<string, Record<string, string | number | boolean>>;
  residence?: string;
  grant_country?: string;
  us_citizen?: boolean;
}

/** The module /cross-border-equity estimates a country with: its equity-tax module, else its supplemental module. */
function crossBorderKind(c: CountryInfo): ExtraKind | null {
  if (c.equity_tax) return "equity-tax";
  if (c.endpoints["supplemental-withholding"]) return "supplemental-withholding";
  return null;
}

/** A value of the compact encodings (country:start:end, country.option:value) must not carry its separators. */
function compactValue(where: string, v: string | number | boolean): string {
  const s = String(v).trim();
  if (!s || /[,:]/.test(s) || s.length > 40) throw new ToolInputError(`${where}: "${s.slice(0, 40)}" must be 1 to 40 characters without commas or colons.`);
  return s;
}

/**
 * Per-country options for /cross-border-equity, checked against the parameters of the module that estimates each
 * country (region and the country's own instrument included), in the API's country.option:value encoding.
 */
function crossBorderOptions(countries: CountryInfo[], periodCountries: CountryInfo[], options: CrossBorderArgs["options"], warnings: string[]): string[] {
  const out: string[] = [];
  const regionGiven = new Set<string>();
  for (const [rawCountry, opts] of Object.entries(options ?? {})) {
    const c = resolveCountry(countries, rawCountry);
    const kind = crossBorderKind(c);
    if (!kind) {
      warnings.push(`Options for ${c.name} were ignored: CalcBloc has no tax estimate for ${c.name}, only the split of the income.`);
      continue;
    }
    const rest: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(opts ?? {})) {
      const key = k.trim().toLowerCase();
      if (key === "region") {
        const { region } = resolveCalcRegion(c, kind, String(v));
        if (region) {
          out.push(`${c.code}.region:${compactValue(`options.${rawCountry}.region`, region)}`);
          regionGiven.add(c.code);
        }
      } else if (key === "instrument") {
        if (kind !== "equity-tax") throw new ToolInputError(`options.${rawCountry}.instrument: ${c.name} is estimated with its supplemental-withholding module, which has no instruments.`);
        const inst = resolveEnumArg(c, kind, "instrument", "Instrument", String(v));
        if (inst) out.push(`${c.code}.instrument:${compactValue(`options.${rawCountry}.instrument`, inst)}`);
      } else rest[k] = v;
    }
    for (const [k, v] of Object.entries(resolveOptions(c, kind, rest))) out.push(`${c.code}.${k}:${compactValue(`options.${rawCountry}.${k}`, v)}`);
  }
  // A region the module requires (Canada's province) is checked here, with the codes, before any request.
  for (const c of periodCountries) {
    const kind = crossBorderKind(c);
    const rp = kind ? endpointParams(c, kind)?.find((p) => p.name === "region") : undefined;
    if (kind && rp?.required && !regionGiven.has(c.code)) {
      const values = rp.values ?? [];
      const list = values.map((v) => (rp.labels?.[v] ? `${v} (${rp.labels[v]})` : v)).join(", ");
      throw new ToolInputError(`${c.name} needs a region for its estimate: pass options {"${shortCodeOf(c)}": {"region": "${values[0] ?? "…"}"}} with one of ${list}.`);
    }
  }
  return out;
}

export async function crossBorderEquity(client: CalcBlocClient, args: CrossBorderArgs): Promise<ToolResult> {
  return guarded(async () => {
    const countries = await onlineCountries(client);
    const instrument = args.instrument.trim().toLowerCase();
    if (instrument === "stock_option" && args.exercise_price === undefined) throw new ToolInputError("exercise_price is required for stock_option.");
    if (args.event_date < args.grant_date) throw new ToolInputError(`event_date (${args.event_date}) cannot be before grant_date (${args.grant_date}).`);
    if (args.vest_date && (args.vest_date < args.grant_date || args.vest_date > args.event_date))
      throw new ToolInputError(`vest_date (${args.vest_date}) must lie between grant_date (${args.grant_date}) and event_date (${args.event_date}).`);
    if (!args.periods.length) throw new ToolInputError("periods needs at least one work period: { country, start, end, workdays? }.");
    const warnings: string[] = [];
    const periodCountries: CountryInfo[] = [];
    const periods = args.periods.map((p, i) => {
      const c = resolveCountry(countries, p.country);
      if (p.end < p.start) throw new ToolInputError(`periods[${i}]: end (${p.end}) is before start (${p.start}).`);
      if (!periodCountries.includes(c)) periodCountries.push(c);
      return `${c.code}:${p.start}:${p.end}${p.workdays !== undefined ? `:${p.workdays}` : ""}`;
    });
    const salaries = Object.entries(args.salaries ?? {}).map(([k, v]) => `${resolveCountry(countries, k).code}:${v}`);
    const options = crossBorderOptions(countries, periodCountries, args.options, warnings);
    const optional: Record<string, QueryValue | undefined> = {
      vest_date: args.vest_date,
      exercise_price: args.exercise_price,
      currency: args.currency?.trim().toUpperCase(),
      residence: args.residence ? resolveCountry(countries, args.residence).code : undefined,
      grant_country: args.grant_country ? resolveCountry(countries, args.grant_country).code : undefined,
      us_citizen: args.us_citizen,
      salaries: salaries.length ? salaries.join(",") : undefined,
      options: options.length ? options.join(",") : undefined,
    };
    const query: Record<string, QueryValue> = {
      instrument,
      units: args.units,
      grant_date: args.grant_date,
      event_date: args.event_date,
      fmv_event: args.fmv_event,
      periods: periods.join(","),
      ...Object.fromEntries(Object.entries(optional).filter((e): e is [string, QueryValue] => e[1] !== undefined)),
    };
    const r = await client.crossBorderEquity(query);
    const x = r.result;
    warnings.push(...(r.warnings ?? []));
    const pageUrl = r.attribution?.url ?? DEVELOPERS_URL;
    const allSources: ResultSource[] = [...x.sources, ...x.countries.flatMap((c) => [...c.sources, ...(c.estimate?.sources ?? [])]), ...x.relief.flatMap((rl) => (rl.treatySource ? [rl.treatySource] : []))];
    const sources = resultSources(allSources, pageUrl, warnings);
    const nameOf = (code: string) => countries.find((c) => c.code === code)?.name ?? code;
    const cur = x.currency;
    const countryOut = (c: CrossBorderCountry) => ({
      country: c.country,
      countryName: nameOf(c.country),
      covered: c.covered,
      currency: c.currency,
      workdays: c.workdays,
      workdayShare: c.workdayShare,
      method: c.method,
      methodLabel: c.methodLabel,
      oecdDefault: c.oecdDefault,
      ruleStatus: c.ruleStatus,
      basis: c.basis,
      taxableShare: c.taxableShare,
      taxableAmount: c.taxableAmount,
      taxableAmountLocal: c.taxableAmountLocal,
      isResidence: c.isResidence,
      estimate: c.estimate
        ? {
            engine: c.estimate.engine,
            instrument: c.estimate.instrument,
            method: c.estimate.method,
            taxYear: c.estimate.taxYear,
            taxableAmount: c.estimate.taxableAmount,
            estimatedTax: c.estimate.estimatedTax,
            withheld: c.estimate.withheld ?? null,
            lines: c.estimate.lines.map((l) => ({
              label: l.label,
              amount: l.amount,
              ...(l.withheld !== undefined ? { withheld: l.withheld } : {}),
              ...(l.rate !== undefined ? { rate: l.rate } : {}),
              ...(l.note !== undefined ? { note: l.note } : {}),
            })),
            notes: c.estimate.notes,
          }
        : null,
      notes: c.notes,
    });
    const shown = x.countries.map(countryOut);
    const lines = [
      `Cross-border equity (estimate): ${x.instrument === "rsu" ? "RSUs" : "stock options"}, ${x.units.toLocaleString("en-US")} units, income ${money(x.totalIncome, cur)} at the event (${x.eventDate})`,
      `Sourcing period ${x.sourcingPeriod.start} to ${x.sourcingPeriod.end} (${x.sourcingPeriod.weekdays} weekdays, ${x.totalWorkdays} workdays counted); residence at the event: ${nameOf(x.residence.country)}; grant country: ${nameOf(x.grantCountry.country)}`,
      `Work periods: ${x.periods.map((p) => `${nameOf(p.country)} ${p.start} to ${p.end}: ${p.workdaysUsed} workdays${p.computed ? " (Monday to Friday, counted)" : ""}${p.clipped ? " (clipped to the sourcing period)" : ""}`).join("; ")}`,
      "",
      "By country:",
    ];
    for (const c of shown) {
      lines.push(
        `- ${c.countryName}${c.isResidence ? " (residence)" : ""}: ${pct(c.workdayShare)} of the workdays; taxable share ${pct(c.taxableShare)} = ${money(c.taxableAmount, cur)}${c.currency !== cur ? ` (${money(c.taxableAmountLocal, c.currency)})` : ""}; basis ${c.basis}; rule: ${c.methodLabel}${c.oecdDefault ? " (OECD default)" : ""} [${c.ruleStatus}]`,
      );
      if (c.estimate) {
        lines.push(`  Estimated tax ${money(c.estimate.estimatedTax, c.currency)}${c.estimate.withheld !== null ? `, withheld ${money(c.estimate.withheld, c.currency)}` : ""} (${c.estimate.method}, tax year ${c.estimate.taxYear}):`);
        for (const l of c.estimate.lines) lines.push(`    - ${l.label}: ${money(l.amount, c.currency)}${l.withheld !== undefined ? ` (withheld ${money(l.withheld, c.currency)})` : ""}${l.rate !== undefined ? ` at ${pct(l.rate)}` : ""}`);
      } else if (!c.covered) lines.push("  No tax estimate for this country (the split only).");
      for (const n of c.notes) lines.push(`  Note: ${n}`);
    }
    if (x.relief.length) lines.push("", "Double taxation (relief not computed):", ...x.relief.map((rl) => `- ${nameOf(rl.source)} / ${nameOf(rl.other)}, overlap ${money(rl.overlap, cur)}, treaty ${rl.treaty}: ${rl.text}`));
    if (x.flags.length) lines.push("", `Flags: ${x.flags.join(", ")}`);
    if (x.underReview.length) lines.push(`Rules not yet confirmed (OECD default used): ${x.underReview.join(", ")}`);
    if (x.notes.length) lines.push("", "Notes:", ...x.notes.map((n) => `- ${n}`));
    const rates = Object.entries(x.fx.rates).map(([k, v]) => `${k.replace("_", "/")} ${v}`);
    if (rates.length) lines.push(`Exchange rates (ECB reference, ${x.fx.referenceDate}): ${rates.join(", ")}`);
    lines.push("", `Inputs used: ${inputsLine(r.inputs)}`, `Page: ${pageUrl}`);
    lines.push(...creditFooter(sources, pageUrl, warnings));
    return ok(lines.join("\n"), {
      estimate: true,
      label: x.label,
      instrument: x.instrument,
      units: x.units,
      currency: cur,
      totalIncome: x.totalIncome,
      sourcingPeriod: x.sourcingPeriod,
      eventDate: x.eventDate,
      residence: x.residence,
      grantCountry: x.grantCountry,
      totalWorkdays: x.totalWorkdays,
      periods: x.periods.map((p) => ({ country: p.country, start: p.start, end: p.end, workdaysGiven: p.workdaysGiven ?? null, workdaysUsed: p.workdaysUsed, computed: p.computed, clipped: p.clipped })),
      countries: shown,
      relief: x.relief.map((rl) => ({ source: rl.source, other: rl.other, overlap: rl.overlap, kind: rl.kind, treaty: rl.treaty, text: rl.text })),
      flags: x.flags,
      notes: x.notes,
      underReview: x.underReview,
      fx: { referenceDate: x.fx.referenceDate, rates: x.fx.rates },
      inputs: r.inputs,
      ...creditFields(sources, pageUrl, warnings),
    });
  });
}

/* ----------------------------------------------------------- API 1.9: trade ----------------------------------------------------------- */

/** Who makes the final determination, by tariff (the figures are never a customs ruling). */
const TRADE_CAVEAT: Record<string, string> = {
  eu: "TARIC is not legally binding (the Official Journal of the European Union is); the customs authority of the member state of import makes the final determination of classification, origin and duty.",
  us: "The Harmonized Tariff Schedule figures are not a ruling: U.S. Customs and Border Protection makes the final determination of classification, origin and duty.",
  gb: "The UK Trade Tariff figures are not a ruling: HMRC makes the final determination of classification, origin and duty.",
  in: "The tariff figures are not a ruling: Indian customs (CBIC) makes the final determination of classification, origin and duty.",
};
export const tradeCaveat = (destination: string): string =>
  TRADE_CAVEAT[destination] ?? "The tariff figures are not a ruling: the customs authority of the importing country makes the final determination of classification, origin and duty.";

const MAX_LIST = 10;
const MAX_TARIFF_TEXT = 30_000;
const DESTINATIONS_HINT = 'gb (the UK), eu or an EU member state (de, fr, it, es, nl…; its import VAT applies), us (the United States) or in (India)';

/** destination and its alias importer: one of them is required; both must name the same country. */
function destinationOf(args: { destination?: string; importer?: string }, name = "destination"): string {
  const a = args.destination?.trim();
  const b = args.importer?.trim();
  if (a && b && a.toLowerCase() !== b.toLowerCase()) throw new ToolInputError(`${name} and importer name different importing countries ("${a}", "${b}"); give one of them.`);
  const d = a || b;
  if (!d) throw new ToolInputError(`${name} (the importing country) is required: ${DESTINATIONS_HINT}.`);
  return d;
}

function hsCode(raw: string, min: number): string {
  const digits = raw.replace(/[\s.]/g, "");
  if (!new RegExp(`^\\d{${min},10}$`).test(digits)) throw new ToolInputError(`hs_code must be ${min} to 10 digits of a commodity code (an HS prefix or the full 10-digit code); dots and spaces are ignored. Got "${raw}".`);
  return digits;
}

/** Additional or document codes: an array or a comma-separated string of 4-character codes. */
function codeList(name: string, raw: string | string[] | undefined, max: number): string | undefined {
  if (raw === undefined) return undefined;
  const list = (Array.isArray(raw) ? raw : raw.split(",")).map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!list.length) return undefined;
  if (list.length > max) throw new ToolInputError(`${name}: at most ${max} codes.`);
  const bad = list.find((c) => !/^[A-Z0-9]{4}$/.test(c));
  if (bad) throw new ToolInputError(`${name}: "${bad}" is not a 4-character code (letters and digits, e.g. ${name === "documents" ? "D008" : "8A95"}).`);
  return list.join(",");
}

const tariffOut = (t: TariffMeta) => ({ destination: t.destination, nomenclature: t.nomenclature, version: t.version, asOf: t.as_of, publisher: t.publisher, source: t.source, licence: t.licence });

function measureBrief(m: TradeMeasure) {
  const q = m.quota;
  return {
    measureType: m.measure_type,
    type: m.measure_type_description,
    area: m.geographical_area_description,
    ...(m.agreement ? { agreement: m.agreement } : {}),
    ...(m.additional_code ? { additionalCode: `${m.additional_code.code} ${m.additional_code.description}`.trim() } : {}),
    ...(q ? { quota: `${q.order_number}${q.volume !== null ? `: ${q.volume.toLocaleString("en-US")}${q.unit ? ` ${q.unit}` : ""}` : ""}${q.period_start ? ` (${q.period_start} to ${q.period_end ?? "…"})` : ""}` } : {}),
    duty: m.duty_described,
    dutyText: m.duty_text,
    ...(m.conditions?.length ? { conditional: true } : {}),
    ...(m.legal_acts[0] ? { legalAct: m.legal_acts[0].code } : {}),
    validFrom: m.valid_from,
    validTo: m.valid_to ?? null,
  };
}

/** Measures that differ only by additional code (exporter-specific anti-dumping duties, say), counted with the first codes. */
function groupMeasures(list: TradeMeasure[]) {
  const groups = new Map<string, { type: string; extraType: string | null; area: string; duty: string; legalAct?: string; count: number; additionalCodes: string[] }>();
  for (const m of list) {
    const legalAct = m.legal_acts[0]?.code;
    const key = [m.measure_type, m.geographical_area, m.duty_described, legalAct ?? ""].join("|");
    let g = groups.get(key);
    if (!g) {
      g = { type: m.measure_type_description, extraType: m.extra_type ?? null, area: m.geographical_area_description, duty: m.duty_described, ...(legalAct ? { legalAct } : {}), count: 0, additionalCodes: [] };
      groups.set(key, g);
    }
    g.count++;
    if (m.additional_code && g.additionalCodes.length < MAX_LIST) g.additionalCodes.push(m.additional_code.code);
  }
  return [...groups.values()];
}

const groupText = (g: ReturnType<typeof groupMeasures>[number]) =>
  `${g.type} (${g.area}): ${g.duty}${g.legalAct ? `, ${g.legalAct}` : ""}${g.count > 1 || g.additionalCodes.length ? `; ${g.count} measure${g.count === 1 ? "" : "s"}${g.additionalCodes.length ? `, additional codes ${g.additionalCodes.join(", ")}${g.count > g.additionalCodes.length ? ", …" : ""}` : ""}` : ""}`;

const briefText = (m: ReturnType<typeof measureBrief>) =>
  `${m.agreement ? `${m.agreement} ` : ""}${m.area}: ${m.duty}${m.additionalCode ? ` [${m.additionalCode}]` : ""}${m.quota ? ` (quota ${m.quota})` : ""}${m.conditional ? " (conditional)" : ""}`;

/** Official sources of a trade answer: the tariff, the code's own page and the legal acts of the measures shown. */
function tradeSources(t: TariffMeta, pages: { code: string; page: string }[], measures: TradeMeasure[], extra: Source[] = []): Source[] {
  const list: Source[] = [{ title: `${t.publisher}: ${t.nomenclature} version ${t.version}`, url: t.source, retrievedAt: t.retrieved_at }];
  for (const p of pages) list.push({ title: `Commodity code ${p.code}`, url: p.page, retrievedAt: t.retrieved_at });
  for (const m of measures) for (const a of m.legal_acts) if (a.url) list.push({ title: `${a.code}: ${a.title}`, url: a.url });
  return uniqueSources([...list, ...extra]);
}

function tradeFooter(t: TariffMeta, sources: Source[], pageUrl: string, warnings: string[], apiDisclaimer?: string): string[] {
  const lines: string[] = [];
  if (warnings.length) lines.push("", "Warnings:", ...warnings.map((w) => `- ${w}`));
  lines.push("", "Official sources:", ...sourceLines(sources));
  lines.push("", `Tariff: ${t.publisher}, ${t.nomenclature} version ${t.version} (as of ${t.as_of}). Licence: ${t.licence}`);
  if (apiDisclaimer) lines.push(apiDisclaimer);
  lines.push(tradeCaveat(t.destination), DISCLAIMER, `${ATTRIBUTION}: ${pageUrl}`);
  return lines;
}

const tradeCredit = (t: TariffMeta, sources: Source[], pageUrl: string, warnings: string[]) => ({
  ...creditFields(sources, pageUrl, warnings),
  licence: t.licence,
  caveat: tradeCaveat(t.destination),
});

const lineNotes = (l: TariffLine): string[] =>
  [...(l.footnotes ?? []).map((f) => f.text), ...(l.notes ?? []).map((n) => (typeof n === "string" ? n : n.text))].filter(Boolean).slice(0, MAX_LIST);

export interface ImportDutyArgs {
  destination?: string;
  importer?: string;
  origin: string;
  hs_code: string;
  customs_value: number;
  quantity?: number;
  unit?: string;
  proof_of_origin?: boolean;
  additional_code?: string | string[];
  documents?: string | string[];
  excise_code?: string;
  vat_code?: string;
  transport?: string;
}

export async function importDuty(client: CalcBlocClient, args: ImportDutyArgs): Promise<ToolResult> {
  return guarded(async () => {
    const destination = destinationOf(args);
    const code = hsCode(args.hs_code, 4);
    if ((args.quantity === undefined) !== (args.unit === undefined || !args.unit.trim())) throw new ToolInputError("quantity and unit go together: give both (e.g. quantity 100, unit \"kg\") or neither.");
    const four = (name: string, v: string | undefined) => {
      if (v === undefined || !v.trim()) return undefined;
      const s = v.trim().toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(s)) throw new ToolInputError(`${name}: "${v}" is not a 4-character code (e.g. ${name === "vat_code" ? "VATZ" : "X311"}).`);
      return s;
    };
    const optional: Record<string, QueryValue | undefined> = {
      quantity: args.quantity,
      unit: args.unit?.trim() || undefined,
      proof_of_origin: args.proof_of_origin,
      additional_code: codeList("additional_code", args.additional_code, 4),
      documents: codeList("documents", args.documents, 10),
      excise_code: four("excise_code", args.excise_code),
      vat_code: four("vat_code", args.vat_code),
      transport: args.transport,
    };
    const query: Record<string, QueryValue> = {
      destination,
      origin: args.origin.trim(),
      code,
      customs_value: args.customs_value,
      ...Object.fromEntries(Object.entries(optional).filter((e): e is [string, QueryValue] => e[1] !== undefined)),
    };
    const r: ImportDutyResponse = await client.importDuty(query);
    const t = r.tariff;
    const warnings = [...(r.warnings ?? [])];
    const cur = r.totals.currency;
    const pageUrl = r.attribution?.url ?? DEVELOPERS_URL;
    const applied = r.lines.flatMap((l) => (l.measure ? [l.measure] : []));
    const basisSources = Object.values(r.basis ?? {}).map((b) => ({ url: b.source }));
    const sources = capSources(tradeSources(t, [{ code: r.line.code, page: r.line.page }], applied, basisSources), pageUrl, warnings);
    const extras = groupMeasures(r.extra_duties_possible);
    const options = r.preferential_all.map(measureBrief);
    const others = r.other_charges.map(measureBrief);
    const into = r.member_state ? `${r.member_state.name} (EU)` : ({ gb: "the United Kingdom", eu: "the European Union", us: "the United States", in: "India" } as Record<string, string>)[t.destination] ?? t.destination;
    const amt = (v: number | null | undefined) => (v === null || v === undefined ? "not computed" : money(v, cur));
    const lines = [
      `Import duty: ${r.line.code} ${r.line.description}, from ${r.origin.name} into ${into}`,
      `Classification: ${[...r.line.path, r.line.description].join(" > ")}`,
      `Customs value: ${money(Number(r.inputs.customs_value), cur)}${r.inputs.quantity !== null && r.inputs.quantity !== undefined ? `; quantity ${String(r.inputs.quantity)} ${String(r.inputs.unit)}` : ""}; proof of origin: ${r.inputs.proof_of_origin ? "yes" : "no"}`,
      `Tariff: ${t.nomenclature} version ${t.version} (as of ${t.as_of}); MFN duty ${r.mfn.duty_described} (${r.mfn.duty_text})`,
      "",
      `Breakdown (${cur}):`,
      ...r.lines.map((l) => `- ${l.label}: ${amt(l.amount)}${l.base !== null ? ` on ${money(l.base, cur)}` : ""}${l.not_computed ? ` (${l.not_computed})` : ""}`),
      "",
      `Customs duty ${amt(r.totals.customs_duty)}; extra duties ${amt(r.totals.extra_duties)}; excise ${amt(r.totals.excise)}; import VAT ${amt(r.totals.import_vat)}${r.totals.fees !== undefined ? `; fees ${amt(r.totals.fees)}` : ""}`,
      `Duties and taxes: ${amt(r.totals.duties_and_taxes)}; landed cost: ${amt(r.totals.landed_cost)}`,
      r.totals.complete ? "Complete: every duty and tax that applies was computed." : "INCOMPLETE: the totals leave out:",
      ...r.totals.incomplete_reasons.map((x) => `- ${x}`),
    ];
    if (options.length) lines.push("", `Preferences for ${r.origin.name} (with a valid proof of origin):`, ...options.slice(0, MAX_LIST).map((m) => `- ${briefText(m)}`));
    if (extras.length) lines.push("", "Extra duties that may apply to this origin:", ...extras.map((g) => `- ${groupText(g)}`));
    if (others.length) lines.push("", "Other charges (listed, not in the totals):", ...others.map((m) => `- ${m.type}: ${m.duty}${m.legalAct ? `, ${m.legalAct}` : ""}`));
    if (r.notes.length) lines.push("", "Notes:", ...r.notes.map((n) => `- ${n}`));
    const basis = Object.entries(r.basis ?? {});
    if (basis.length) lines.push("", "Basis:", ...basis.map(([k, b]) => `- ${k.replace(/_/g, " ")}: ${b.rule}`));
    lines.push("", `Tariff page: ${r.line.page}`, `Page: ${pageUrl}`);
    lines.push(...tradeFooter(t, sources, pageUrl, warnings, r.disclaimer));
    return ok(lines.join("\n"), {
      destination: t.destination,
      memberState: r.member_state ?? null,
      origin: { iso: r.origin.iso, name: r.origin.name },
      tariff: tariffOut(t),
      commodity: { code: r.line.code, description: r.line.description, path: r.line.path, supplementaryUnit: r.line.supplementary_unit ?? null },
      currency: cur,
      customsValue: Number(r.inputs.customs_value),
      lines: r.lines.map((l) => ({
        kind: l.kind,
        label: l.label,
        measure: l.measure ? measureBrief(l.measure) : null,
        base: l.base ?? null,
        baseDescription: l.base_description,
        amount: l.amount ?? null,
        notComputed: l.not_computed ?? null,
        source: l.source,
      })),
      totals: {
        customsDuty: r.totals.customs_duty ?? null,
        extraDuties: r.totals.extra_duties ?? null,
        excise: r.totals.excise ?? null,
        importVat: r.totals.import_vat ?? null,
        fees: r.totals.fees ?? null,
        dutiesAndTaxes: r.totals.duties_and_taxes ?? null,
        landedCost: r.totals.landed_cost ?? null,
        complete: r.totals.complete,
        incompleteReasons: r.totals.incomplete_reasons,
      },
      mfn: { duty: r.mfn.duty_described, dutyText: r.mfn.duty_text, amount: r.mfn.amount ?? null },
      preferential: r.preferential ? measureBrief(r.preferential) : null,
      preferentialOptions: options,
      extraDutiesPossible: extras,
      otherCharges: others,
      notes: r.notes,
      basis: r.basis ?? {},
      tariffDisclaimer: r.disclaimer,
      inputs: r.inputs,
      ...tradeCredit(t, sources, pageUrl, warnings),
    });
  });
}

export interface TariffArgs {
  destination?: string;
  importer?: string;
  hs_code: string;
  origin?: string;
  limit?: number;
  cursor?: string;
}

export async function tariff(client: CalcBlocClient, args: TariffArgs): Promise<ToolResult> {
  return guarded(async () => {
    const destination = destinationOf(args);
    const code = hsCode(args.hs_code, 2);
    const limit = args.limit ?? MAX_LIST;
    const query: Record<string, QueryValue> = { destination, code, limit, ...(args.origin?.trim() ? { origin: args.origin.trim() } : {}), ...(args.cursor?.trim() ? { cursor: args.cursor.trim() } : {}) };
    const r = await client.tariffs(query);
    const t = r.tariff;
    const warnings: string[] = [];
    const pageUrl = r.attribution?.url ?? DEVELOPERS_URL;
    const withOrigin = !!r.origin;
    const shown = r.lines.map((l) => {
      const prefs = l.preferential.map(measureBrief);
      const byDuty = new Map<string, string[]>();
      if (!withOrigin) for (const p of prefs) byDuty.set(p.duty, [...(byDuty.get(p.duty) ?? []), p.agreement ?? p.area]);
      return {
        code: l.code,
        description: l.description,
        path: l.path,
        supplementaryUnit: l.supplementary_unit ?? null,
        mfn: { duty: l.mfn.duty_described, dutyText: l.mfn.duty_text },
        thirdCountry: l.third_country.slice(0, MAX_LIST).map(measureBrief),
        bestPreferential: l.best_preferential ? measureBrief(l.best_preferential) : null,
        preferential: withOrigin ? prefs.slice(0, 2 * MAX_LIST) : [],
        preferentialByDuty: [...byDuty.entries()].map(([duty, agreements]) => ({ duty, agreements: [...new Set(agreements)] })),
        preferentialCount: prefs.length,
        suspensions: l.suspensions.slice(0, MAX_LIST).map(measureBrief),
        quotas: l.quotas.slice(0, MAX_LIST).map(measureBrief),
        extraDuties: groupMeasures(l.extra_duties),
        surcharges: (l.surcharges ?? []).slice(0, MAX_LIST).map(measureBrief),
        importVat: l.import_vat.slice(0, MAX_LIST).map(measureBrief),
        excise: l.excise.slice(0, MAX_LIST).map(measureBrief),
        otherCharges: (l.other_charges ?? []).slice(0, MAX_LIST).map(measureBrief),
        notes: lineNotes(l),
        source: l.source,
        page: l.page,
      };
    });
    const lineText = (s: (typeof shown)[number]): string[] => {
      const out = [`### ${s.code} ${s.description}`, `(${s.path.join(" > ")}${s.supplementaryUnit ? `; supplementary unit ${s.supplementaryUnit}` : ""})`, `- MFN (third-country) duty: ${s.mfn.duty} (${s.mfn.dutyText})`];
      if (s.thirdCountry.length > 1) out.push(...s.thirdCountry.map((m) => `- ${m.type}: ${briefText(m)}`));
      if (withOrigin) {
        out.push(`- Best preference for ${r.origin!.name}: ${s.bestPreferential ? briefText(s.bestPreferential) : "none without a quota, licence or condition"}`);
        if (s.preferential.length) out.push(`- Preferences for ${r.origin!.name}: ${s.preferential.map(briefText).join("; ")}`);
      } else if (s.preferentialCount) out.push(`- Preferences (${s.preferentialCount}): ${s.preferentialByDuty.map((g) => `${g.duty}: ${g.agreements.slice(0, 2 * MAX_LIST).join(", ")}${g.agreements.length > 2 * MAX_LIST ? ", …" : ""}`).join("; ")}`);
      if (s.suspensions.length) out.push(`- Suspensions: ${s.suspensions.map(briefText).join("; ")}`);
      if (s.quotas.length) out.push(`- Tariff quotas: ${s.quotas.map(briefText).join("; ")}`);
      if (s.extraDuties.length) out.push(...s.extraDuties.map((g) => `- Extra duty: ${groupText(g)}`));
      if (s.surcharges.length) out.push(`- Surcharges: ${s.surcharges.map(briefText).join("; ")}`);
      if (s.importVat.length) out.push(`- Import VAT: ${s.importVat.map((m) => `${m.duty}${m.additionalCode ? ` [${m.additionalCode}]` : ""}`).join("; ")}`);
      if (s.excise.length) out.push(`- Excise: ${s.excise.map((m) => `${m.duty}${m.additionalCode ? ` [${m.additionalCode}]` : ""}`).join("; ")}`);
      if (s.otherCharges.length) out.push(`- Other charges (not in duty totals): ${s.otherCharges.map((m) => `${m.type}: ${m.duty}`).join("; ")}`);
      for (const n of s.notes) out.push(`- Note: ${n}`);
      out.push(`- Tariff page: ${s.page}`);
      return out;
    };
    const lines = [
      `Tariff: ${t.nomenclature} version ${t.version} (as of ${t.as_of}), code ${code}${r.origin ? `, origin ${r.origin.name}` : ""}: lines ${r.count} of ${r.total}`,
    ];
    let cut = shown.length;
    for (let i = 0; i < shown.length; i++) {
      const block = ["", ...lineText(shown[i]!)];
      if (i > 0 && lines.join("\n").length + block.join("\n").length > MAX_TARIFF_TEXT) {
        cut = i;
        break;
      }
      lines.push(...block);
    }
    if (cut < shown.length) warnings.push(`The text shows ${cut} of the ${shown.length} lines of this page (all are in the structured result); use a longer code or a smaller limit.`);
    if (!withOrigin && shown.some((s) => s.preferentialCount)) warnings.push("Pass origin for the preferences, extra duties and best rate that apply to one country of origin.");
    if (r.next_cursor) lines.push("", `More lines: call get_tariff again with cursor "${r.next_cursor}" (${r.total - r.count} after this page, if pages are full).`);
    const sources = capSources(tradeSources(t, r.lines.slice(0, MAX_LIST), []), pageUrl, warnings);
    lines.push(...tradeFooter(t, sources, pageUrl, warnings));
    return ok(lines.join("\n"), {
      tariff: tariffOut(t),
      origin: r.origin ? { iso: r.origin.iso, name: r.origin.name } : null,
      code,
      total: r.total,
      count: r.count,
      nextCursor: r.next_cursor ?? null,
      lines: shown,
      ...tradeCredit(t, sources, pageUrl, warnings),
    });
  });
}

export interface AgreementsArgs {
  destination?: string;
  importer?: string;
  partner?: string;
  agreement?: string;
}

export async function tradeAgreements(client: CalcBlocClient, args: AgreementsArgs): Promise<ToolResult> {
  return guarded(async () => {
    const country = destinationOf(args);
    const r = await client.tradeAgreements({ country, ...(args.partner?.trim() ? { partner: args.partner.trim() } : {}) });
    const t = r.tariff;
    const warnings: string[] = [];
    const pageUrl = r.attribution?.url ?? DEVELOPERS_URL;
    let list: TradeAgreement[] = r.agreements;
    const wanted = args.agreement?.trim().toLowerCase();
    if (wanted) {
      list = list.filter((a) => a.id.toLowerCase() === wanted || a.title.toLowerCase().includes(wanted));
      if (!list.length) throw new ToolInputError(`No agreement "${args.agreement}" in the ${t.destination} tariff${r.partner ? ` for ${r.partner.name}` : ""}. Agreements: ${r.agreements.map((a) => a.id).join(", ")}.`);
    }
    const detailed = !!(wanted || r.partner);
    const shown = list.map((a) => ({
      id: a.id,
      title: a.title,
      type: a.type,
      parties: a.parties,
      signed: a.signed ?? null,
      inForce: a.in_force ?? null,
      origins: a.direction.origins.slice(0, 4 * MAX_LIST),
      originCount: a.direction.origins.length,
      ...(detailed ? { rulesOfOrigin: a.rules_of_origin.summary, links: a.links ?? [] } : {}),
    }));
    const lines = [`Trade agreements and preference schemes in the ${t.nomenclature} tariff (imports into ${t.destination}, version ${t.version})${r.partner ? ` covering ${r.partner.name}` : ""}: ${shown.length}`, ""];
    for (const a of shown) {
      lines.push(`- ${a.id}: ${a.title} [${a.type}]${a.signed ? `, signed ${a.signed}` : ""}${a.inForce ? `, in force ${a.inForce}` : ""}; origins: ${a.originCount ? `${a.origins.join(", ")}${a.originCount > a.origins.length ? `, … (${a.originCount})` : ""}` : "as the program defines them"}`);
      if (a.rulesOfOrigin) lines.push(`  Rules of origin: ${a.rulesOfOrigin}`);
      for (const l of a.links ?? []) lines.push(`  ${l.text}: ${l.url}`);
    }
    lines.push("", "Agreements are directional: these are the preferences for imports into this tariff's territory. get_tariff or calculate_import_duty with origin shows the rate for a code.");
    if (!detailed) lines.push("Call again with partner (an origin country) or agreement (an id) for the rules of origin and official links.");
    const agreementSources = (detailed ? list : []).flatMap((a) => [a.rules_of_origin.source, ...a.sources]).flatMap((s) => (s.url ? [{ url: s.url, ...(s.title ? { title: s.title } : {}), ...(s.retrieved_at ? { retrievedAt: s.retrieved_at } : {}) }] : []));
    const sources = capSources(tradeSources(t, [], [], agreementSources), pageUrl, warnings);
    lines.push(...tradeFooter(t, sources, pageUrl, warnings));
    return ok(lines.join("\n"), {
      tariff: tariffOut(t),
      partner: r.partner ? { iso: r.partner.iso, name: r.partner.name } : null,
      count: shown.length,
      agreements: shown,
      ...tradeCredit(t, sources, pageUrl, warnings),
    });
  });
}

/* ----------------------------------------------------------- API 1.9: tax calendar ----------------------------------------------------------- */

const calSource = (s: CalendarSource) => ({ title: s.title, url: s.url, retrievedAt: s.retrieved_at });
const regionOut = (r: { code: string; name: string } | null | undefined) => (r ? { code: r.code, name: r.name } : null);
const MAX_CHANGES = 40;

export async function taxCalendar(client: CalcBlocClient, args: { country?: string; region?: string }): Promise<ToolResult> {
  return guarded(async () => {
    const countries = await onlineCountries(client);
    const warnings: string[] = [];
    if (!args.country?.trim()) {
      if (args.region?.trim()) throw new ToolInputError("region needs country (e.g. country us, region ca).");
      const withCal = countries.filter((c) => c.tax_calendar);
      if (!withCal.length) throw new ToolInputError("The tax calendar is not offered by the CalcBloc API in use (it needs API 1.9 or later).");
      const summary = withCal.map((c) => {
        const k = c.tax_calendar!;
        return {
          country: c.code,
          shortCode: shortCodeOf(c),
          name: c.name,
          taxYear: k.tax_year.label,
          start: k.tax_year.start,
          end: k.tax_year.end,
          type: k.tax_year.type,
          daysRemaining: k.days_remaining,
          nextTaxYearStart: k.next_tax_year?.start ?? null,
          upcomingChanges: k.upcoming_changes,
          nextChange: k.next_change ? { effectiveFrom: k.next_change.effective_from, title: k.next_change.title, status: k.next_change.status } : null,
          nextBudget: k.next_budget.status === "scheduled" && k.next_budget.date ? `${k.next_budget.event ?? "Budget"} on ${k.next_budget.date}` : k.next_budget.status,
        };
      });
      const lines = [
        `Tax calendars for ${summary.length} countries${client.countriesAsOf ? `, as of ${client.countriesAsOf}` : ""}: tax year in force, days remaining, upcoming enacted or announced changes, next budget.`,
        "",
        ...summary.map(
          (s) =>
            `- ${s.shortCode}: ${s.name}, tax year ${s.taxYear} (${s.start} to ${s.end}, ${s.type}), ${s.daysRemaining} days left; next year from ${s.nextTaxYearStart ?? "n/a"}; ${s.upcomingChanges} upcoming change${s.upcomingChanges === 1 ? "" : "s"}${s.nextChange ? `, next ${s.nextChange.effectiveFrom}: ${s.nextChange.title} [${s.nextChange.status}]` : ""}; next budget: ${s.nextBudget.replace(/_/g, " ")}`,
        ),
        "",
        "Call get_tax_calendar with a country for every change with its official source.",
        "",
        `${ATTRIBUTION}: ${DEVELOPERS_URL}`,
      ];
      return ok(lines.join("\n"), { asOf: client.countriesAsOf ?? null, calendar: null, countries: summary, ...creditFields([], DEVELOPERS_URL, warnings) });
    }
    const country = resolveCountry(countries, args.country);
    const { region, warning } = resolveTableRegion(country, args.region);
    if (warning) warnings.push(warning);
    const r = await client.taxCalendar({ country: country.code, ...(region ? { region } : {}) });
    const k: TaxCalendar = r.calendar;
    const changes = k.upcoming_changes.slice(0, MAX_CHANGES);
    if (k.upcoming_changes.length > changes.length) warnings.push(`${k.upcoming_changes.length - changes.length} later changes are listed on ${k.page_url}.`);
    const pageUrl = k.page_url;
    const sources = capSources(
      uniqueSources([...changes.map((c) => calSource(c.source)), ...(k.other_periods ?? []).map((p) => calSource(p.source)), ...(k.last_budget ? [calSource(k.last_budget.source)] : []), ...(k.next_budget.source ? [calSource(k.next_budget.source)] : [])]),
      pageUrl,
      warnings,
    );
    const place = k.region ? `${k.country_name} (${k.region.name})` : k.country_name;
    const lines = [
      `Tax calendar: ${place}, as of ${k.as_of}`,
      `Tax year in force: ${k.tax_year.display_label} (${k.tax_year.start} to ${k.tax_year.end}, ${k.tax_year.type} year), ${k.tax_year.days_remaining} days remaining${k.tax_year.data_year && k.tax_year.data_year !== k.tax_year.label ? `; the tax tables still hold ${k.tax_year.data_year}` : ""}`,
      `Next tax year: ${k.next_tax_year ? `${k.next_tax_year.display_label} from ${k.next_tax_year.start}` : "n/a"}`,
    ];
    for (const p of k.other_periods ?? []) lines.push(`Other period: ${p.tax}, ${p.label} (${p.start} to ${p.end})`);
    lines.push(`Next budget: ${k.next_budget.status === "scheduled" ? `${k.next_budget.event ?? "Budget"} on ${k.next_budget.date}` : "not announced"}${k.last_budget ? `; last: ${k.last_budget.event} (${k.last_budget.date})` : ""}`);
    if (k.next_year_note) lines.push(`Next year check (${k.next_year_note.checked_at}): ${k.next_year_note.text}`);
    lines.push("", `Upcoming changes, ${k.window.from} to ${k.window.to} (${k.upcoming_changes.length}):`);
    if (!changes.length) lines.push("- none enacted or announced in this window");
    for (const c of changes)
      lines.push(
        `- ${c.effective_from}${c.date_precision !== "day" ? ` (${c.date_precision})` : ""}${c.effective_to ? ` to ${c.effective_to}` : ""} [${c.status}] ${c.tax}${c.region ? ` (${c.region.name})` : ""}: ${c.title}${c.detail ? `. ${c.detail}` : ""}. Source: ${c.source.url}`,
      );
    lines.push("", "Nothing is estimated: changes are listed only when enacted or officially announced; announced changes can still change before they become law.", `Tax tables: ${pageUrl}`);
    lines.push(...creditFooter(sources, pageUrl, warnings));
    return ok(lines.join("\n"), {
      asOf: k.as_of,
      calendar: {
        country: k.country,
        countryName: k.country_name,
        region: regionOut(k.region),
        taxYear: { label: k.tax_year.label, displayLabel: k.tax_year.display_label, start: k.tax_year.start, end: k.tax_year.end, type: k.tax_year.type, daysRemaining: k.tax_year.days_remaining, dataYear: k.tax_year.data_year ?? null },
        nextTaxYear: k.next_tax_year ? { label: k.next_tax_year.label, displayLabel: k.next_tax_year.display_label, start: k.next_tax_year.start, end: k.next_tax_year.end } : null,
        otherPeriods: (k.other_periods ?? []).map((p) => ({ tax: p.tax, label: p.label, start: p.start, end: p.end, source: calSource(p.source) })),
        upcomingChanges: changes.map((c) => ({
          id: c.id,
          effectiveFrom: c.effective_from,
          datePrecision: c.date_precision,
          effectiveTo: c.effective_to ?? null,
          title: c.title,
          detail: c.detail ?? null,
          tax: c.tax,
          region: regionOut(c.region),
          status: c.status,
          source: calSource(c.source),
          quote: c.quote ?? null,
        })),
        window: k.window,
        nextBudget: { status: k.next_budget.status, event: k.next_budget.event ?? null, date: k.next_budget.date ?? null },
        lastBudget: k.last_budget ? { event: k.last_budget.event, date: k.last_budget.date } : null,
        nextYearNote: k.next_year_note?.text ?? null,
        pageUrl,
      },
      countries: null,
      ...creditFields(sources, pageUrl, warnings),
    });
  });
}

/* ----------------------------------------------------------- facts (/facts, API 1.8+) ----------------------------------------------------------- */

export interface FactsArgs {
  country?: string;
  tax_type?: string;
  jurisdiction?: string;
  level?: string;
  year?: string;
  limit?: number;
  cursor?: string;
}

function factValue(f: TaxFact): string {
  if (f.measure === "bands" && f.bands?.length) return f.bands.map((b) => `${b.label ? `${b.label} ` : ""}${b.from.toLocaleString("en-US")} ${b.to === null ? "and above" : `to ${b.to.toLocaleString("en-US")}`} at ${pct(b.rate, 3)}`).join("; ");
  if (typeof f.value === "number") {
    if (f.unit === "rate") return pct(f.value, 3);
    if (f.unit === "money" && f.currency) return money(f.value, f.currency);
    return f.value.toLocaleString("en-US");
  }
  if (typeof f.value === "string") return f.value;
  return f.measure === "none" ? "none" : "";
}

export async function searchFacts(client: CalcBlocClient, args: FactsArgs): Promise<ToolResult> {
  return guarded(async () => {
    const query: Record<string, QueryValue> = { limit: args.limit ?? 25 };
    if (args.country?.trim()) query.country = resolveCountry(await onlineCountries(client), args.country).code;
    if (args.tax_type?.trim()) query.tax_type = args.tax_type.trim().toLowerCase();
    if (args.jurisdiction?.trim()) query.jurisdiction = args.jurisdiction.trim().toLowerCase();
    if (args.level) query.level = args.level;
    if (args.year?.trim()) query.year = normalizeYear(args.year);
    if (args.cursor?.trim()) query.cursor = args.cursor.trim();
    const r = await client.facts(query);
    const warnings: string[] = [];
    const pageUrl = r.attribution?.url ?? DEVELOPERS_URL;
    const facts = r.facts.map((f) => ({
      id: f.id,
      country: f.country_code ?? f.country,
      jurisdiction: f.jurisdiction,
      level: f.level,
      taxType: f.tax_type,
      label: f.label ?? f.section ?? f.id,
      section: f.section ?? null,
      measure: f.measure,
      value: f.value ?? null,
      bands: f.bands ? f.bands.map((b) => ({ ...(b.label ? { label: b.label } : {}), from: b.from, to: b.to ?? null, rate: b.rate })) : null,
      unit: f.unit ?? null,
      currency: f.currency ?? null,
      basis: f.basis || null,
      note: f.note || null,
      appliesWhen: f.applies_when ?? null,
      taxYear: f.tax_year,
      validFrom: f.valid_from,
      validTo: f.valid_to ?? null,
      status: f.status,
      source: { url: f.source.url, ...(f.source.title ? { title: f.source.title } : {}), ...(f.source.retrieved_at ? { retrievedAt: f.source.retrieved_at } : {}) },
    }));
    const filters = Object.entries(r.filters ?? {}).map(([k, v]) => `${k}=${v}`).join(", ") || "none";
    const lines = [`Tax facts (filters: ${filters}): ${r.count} of ${r.total}`, ""];
    for (let i = 0; i < facts.length; i++) {
      const f = facts[i]!;
      const v = factValue(r.facts[i]!);
      lines.push(
        `- [${f.taxType}] ${f.label}${v ? `: ${v}` : ""} (${f.jurisdiction}, ${f.level}, tax year ${f.taxYear}, ${f.validFrom} to ${f.validTo ?? "further notice"}${f.status !== "verified" ? `, ${f.status}` : ""})${f.basis ? `. Basis: ${f.basis}` : ""}${f.appliesWhen ? `. Applies when: ${f.appliesWhen}` : ""}${f.note ? `. ${f.note}` : ""} Source: ${f.source.url}`,
      );
    }
    if (!facts.length) lines.push("- no facts match these filters (tax_type takes a code or a dotted prefix such as income.pit or consumption.)");
    if (r.next_cursor) lines.push("", `More facts: call search_tax_facts again with the same filters and cursor "${r.next_cursor}".`);
    const sources = capSources(uniqueSources(facts.map((f) => f.source)), pageUrl, warnings);
    lines.push("", `Page: ${pageUrl}`, ...creditFooter(sources, pageUrl, warnings));
    return ok(lines.join("\n"), {
      filters: r.filters ?? {},
      total: r.total,
      count: r.count,
      nextCursor: r.next_cursor ?? null,
      facts,
      ...creditFields(sources, pageUrl, warnings),
    });
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
    "calculate_cross_border_equity",
    {
      title: "Split equity income between countries (mobile employees)",
      description:
        `For an employee who worked in several countries between grant and vest: splits an RSU vest or stock option exercise between those countries by workdays (OECD Commentary on Article 15) or the country's own official rule (US Treas. Reg. § 1.861-4, HMRC relevant period, Ireland, Singapore, Canada), then estimates each country's tax and withholding on its share. Tax estimates for: ${COVERAGE.crossBorderCountries.join(", ")}; the split works for every country. Flags where two countries tax the same income (relief by credit or exemption under the treaty); treaty rates and the relief amount are not computed. Canada needs options {"ca":{"region":"on"}}. Every result is an estimate. Returns the rule used per country, official source URLs and the calcbloc.com page. ${NOT_YET_SUPPORTED}`,
      inputSchema: z.object({
        instrument: z.enum(["rsu", "stock_option"]).describe("rsu (RSUs and share awards, taxed at vest) or stock_option (taxed at exercise). Each country maps it to its own instrument; override with options {\"us\":{\"instrument\":\"iso\"}}."),
        units: z.number().positive().max(1_000_000_000).describe("Shares vesting or options exercised."),
        grant_date: dateArg.describe("Grant date (YYYY-MM-DD): start of the sourcing period."),
        event_date: dateArg.describe("Vest date (RSUs) or exercise date (options) (YYYY-MM-DD): the taxing event."),
        vest_date: dateArg.optional().describe("Vest date (YYYY-MM-DD), the end of the sourcing period, for options exercised after vesting. Default: event_date."),
        fmv_event: z.number().min(0).max(1_000_000_000).describe("Market value per share at the event, in `currency`."),
        exercise_price: z.number().min(0).max(1_000_000_000).optional().describe("Exercise price per share, in `currency` (required for stock_option; RSUs: any amount paid, default 0)."),
        currency: z.string().length(3).optional().describe("Currency of fmv_event and exercise_price (USD, EUR, GBP, AUD, NZD, CAD, INR or SGD). Default USD. Each country's share is converted at the ECB reference rate."),
        periods: z
          .array(
            z.object({
              country: z.string().min(2).max(60).describe("Country short code or name."),
              start: dateArg.describe("First day of the period (YYYY-MM-DD)."),
              end: dateArg.describe("Last day of the period (YYYY-MM-DD), included."),
              workdays: z.number().min(0).max(10_000).optional().describe("Days worked in that country in the period. Omitted: Monday to Friday days are counted, and the result says so."),
            }),
          )
          .min(1)
          .max(20)
          .describe("Where the employee worked between grant and vest, e.g. [{country:\"us\",start:\"2024-01-01\",end:\"2024-12-31\",workdays:220},{country:\"uk\",start:\"2025-01-01\",end:\"2025-06-30\",workdays:120}]."),
        salaries: z.record(z.string(), z.number().min(0).max(1_000_000_000)).optional().describe('Regular annual salary per country in that country\'s currency, e.g. {"us":150000,"uk":80000} (marginal rates and contribution ceilings; a missing country is estimated as if there were no other income there).'),
        options: z
          .record(z.string(), z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])))
          .optional()
          .describe('Per-country options of that country\'s equity or supplemental module, e.g. {"us":{"filing_status":"mfj","region":"ny"},"ca":{"region":"on"},"de":{"tax_class":3}}; also region and instrument. list_countries with the country shows its options.'),
        residence: z.string().max(60).optional().describe("Tax residence at the event. Default: the country of the period that contains event_date."),
        grant_country: z.string().max(60).optional().describe("Country where the employee worked at grant (Singapore's rule). Default: from the periods."),
        us_citizen: z.boolean().optional().describe("US citizen: the US taxes worldwide income whatever the residence. Default false."),
      }),
      outputSchema: CrossBorderOutput,
      annotations: { ...READ_ONLY },
    },
    async (args) => crossBorderEquity(client, args),
  );

  const destinationArg = z
    .string()
    .min(2)
    .max(40)
    .optional()
    .describe(`Importing country (required, or give importer): ${DESTINATIONS_HINT}. Names work too ("United Kingdom", "Germany").`);
  const importerArg = z.string().min(2).max(40).optional().describe("Alias of destination (the importing country).");

  server.registerTool(
    "calculate_import_duty",
    {
      title: "Calculate import duty and landed cost",
      description:
        `Duties and taxes on one import, as of the tariff's version date: the third-country (MFN) duty or, with proof_of_origin, the lowest preferential duty under a trade agreement; extra duties in force for the origin (anti-dumping, countervailing, safeguard, US Section 301); excise (UK); import VAT (UK, or the EU member state's standard rate); US entry fees; and the landed cost. Destinations: ${DESTINATIONS_HINT}. Each line has its measure, legal instrument and source. A duty that cannot be computed (a specific duty without quantity, an exporter-specific anti-dumping duty without additional_code) is shown as not computed and totals.complete is false with the reasons. Use get_tariff to find the 10-digit code. The figures are an estimate, not a customs ruling: TARIC is not legally binding, and the customs authority makes the final determination.`,
      inputSchema: z.object({
        destination: destinationArg,
        importer: importerArg,
        origin: z.string().min(2).max(40).describe('Country of origin of the goods (ISO code or name), e.g. "cn", "India".'),
        hs_code: z.string().min(4).max(14).describe('The 10-digit commodity code of the importing tariff (a shorter prefix works when it matches one line only), e.g. "0901210000"; dots and spaces are ignored.'),
        customs_value: z.number().positive().max(1_000_000_000).describe("Customs value in the tariff's currency: CIF (price plus transport and insurance to the border) in GBP for the UK and EUR for the EU; the transaction value in USD for the US; INR for India."),
        quantity: z.number().min(0).max(1_000_000_000).optional().describe("Quantity in unit, for specific duties and excise (give unit too)."),
        unit: z.string().max(30).optional().describe('Unit of quantity: kg, g, tonne, 100 kg, l, hl, items, 1000 items, pairs, m, m2, m3, or the tariff\'s own unit (e.g. "% vol/hl").'),
        proof_of_origin: z.boolean().optional().describe("true when the goods have a valid proof of origin for a preference: the lowest preferential duty is used instead of MFN. Default false."),
        additional_code: z.union([z.string().max(20), z.array(z.string().max(4)).max(4)]).optional().describe("Additional codes declared with the commodity code (up to 4): the exporter's code for exporter-specific anti-dumping or countervailing duties (e.g. 8A95)."),
        documents: z.union([z.string().max(60), z.array(z.string().max(4)).max(10)]).optional().describe("Document (certificate) codes declared with the goods (up to 10), e.g. D008 for the invoice that gives an EU exporter its own anti-dumping rate."),
        excise_code: z.string().max(4).optional().describe("UK excise additional code where several apply (e.g. X311)."),
        vat_code: z.string().max(4).optional().describe("UK VAT additional code for another VAT rate (e.g. VATZ zero rate, VATR reduced rate)."),
        transport: z.enum(["vessel", "air", "truck", "rail", "mail", "other"]).optional().describe("US only: how the goods arrive; vessel adds the harbor maintenance fee."),
      }),
      outputSchema: ImportDutyOutput,
      annotations: { ...READ_ONLY },
    },
    async (args) => importDuty(client, args),
  );

  server.registerTool(
    "get_tariff",
    {
      title: "Look up tariff lines by commodity code",
      description:
        `The importing country's tariff lines for a commodity code or HS prefix: description, MFN duty, tariff preferences with their agreements and quotas, suspensions, extra duties (anti-dumping and others, grouped by exporter additional code), import VAT, excise and other charges, each in the tariff's own wording, as of the tariff's version date. Tariffs: ${DESTINATIONS_HINT}. With origin, only the measures for that origin and the best preferential rate. Paginated: pass nextCursor as cursor for more lines. Not a customs ruling.`,
      inputSchema: z.object({
        destination: destinationArg,
        importer: importerArg,
        hs_code: z.string().min(2).max(14).describe('Commodity code: an HS prefix (2, 4, 6 or 8 digits) or the full 10-digit code, e.g. "0901" or "8471.30"; dots and spaces are ignored.'),
        origin: z.string().min(2).max(40).optional().describe("Country of origin (ISO code or name): keeps only the measures that apply to it and adds the best preferential rate."),
        limit: z.number().int().min(1).max(25).optional().describe("Lines per page (1 to 25, default 10)."),
        cursor: z.string().max(40).optional().describe("nextCursor from the previous call, with the same destination, hs_code and origin."),
      }),
      outputSchema: TariffOutput,
      annotations: { ...READ_ONLY },
    },
    async (args) => tariff(client, args),
  );

  server.registerTool(
    "list_trade_agreements",
    {
      title: "List trade agreements and preference schemes",
      description:
        `Every trade agreement and preference scheme in an importing country's tariff (free trade agreements, customs unions, GSP and DCTS tiers, US special programs): id, official title, type, parties, signing date and the origin countries it covers. With partner (an origin country) or agreement (an id from get_tariff), also the rules of origin and the official links. Tariffs: ${DESTINATIONS_HINT}. Agreements are directional: these are the preferences for imports into the destination.`,
      inputSchema: z.object({
        destination: destinationArg,
        importer: importerArg,
        partner: z.string().min(2).max(40).optional().describe("Only agreements covering this origin country (ISO code or name)."),
        agreement: z.string().max(80).optional().describe('One agreement: its id (e.g. "eu-gb-tca", "gb-in-ceta") or words of its title.'),
      }),
      outputSchema: AgreementsOutput,
      annotations: { ...READ_ONLY },
    },
    async (args) => tradeAgreements(client, args),
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
    "search_tax_facts",
    {
      title: "Search tax facts",
      description: `Every tax-table figure as a fact tagged with its tax type, jurisdiction and level of government, each with its value (rate, amount or bands), validity dates, status and official source. Filter by country, tax_type (a code or dotted prefix: income.pit, payroll.ss, consumption.), jurisdiction (gb-sct, us-ca, ca-on), level and year, across all ${COVERAGE.taxTables} countries; for example every US state sales tax rate, or one country's income tax bands. Paginated: pass nextCursor as cursor.`,
      inputSchema: z.object({
        country: z.string().max(60).optional().describe("Country short code or name. Default: every country."),
        tax_type: z
          .string()
          .max(80)
          .optional()
          .describe("Tax type code or dotted prefix, e.g. income.pit, payroll.ss (every social security branch), consumption. (every consumption tax), consumption.sales.state. An unknown type returns the list of top-level types."),
        jurisdiction: z.string().max(40).optional().describe("Jurisdiction id, exact: gb, gb-sct, us-ca, ca-on (ISO 3166-1/3166-2 based)."),
        level: z.enum(["national", "state", "county", "municipal", "special_district"]).optional().describe("Tier of government that levies the tax."),
        year: z.string().max(10).optional().describe('Tax year (e.g. "2026" or "2026-27"), or "latest" for each country\'s current year. Default: every year served.'),
        limit: z.number().int().min(1).max(100).optional().describe("Facts per page (1 to 100, default 25)."),
        cursor: z.string().max(40).optional().describe("nextCursor from the previous call, with the same filters."),
      }),
      outputSchema: FactsOutput,
      annotations: { ...READ_ONLY },
    },
    async (args) => searchFacts(client, args),
  );

  server.registerTool(
    "get_tax_calendar",
    {
      title: "Get the tax calendar",
      description: `A country's tax calendar: the tax year in force (dates, calendar or fiscal, days remaining), when the next tax year starts, other tax periods, every change already enacted or officially announced for the next 24 months (effective date, what changes, status and the official source) and the last and next budget dates (next budget "not announced" unless the government has announced it). Nothing is estimated. Without country: one line per country (${COVERAGE.taxCalendar} countries). With region (US state, Canadian province, UK nation…), that region's changes too.`,
      inputSchema: z.object({
        country: z.string().max(60).optional().describe("Country short code or name. Omit for every country."),
        region: z.string().max(60).optional().describe("Region code or name for a country with regional tax tables (us: state code; ca: province; uk: scotland or wales). Needs country."),
      }),
      outputSchema: TaxCalendarOutput,
      annotations: { ...READ_ONLY },
    },
    async (args) => taxCalendar(client, args),
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

