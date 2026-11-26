import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { API_KEY_URL_APP, DEFAULT_API_URL, DEVELOPERS_URL, SERVER_NAME, SERVER_VERSION } from "./constants.js";

/** One parameter of a calculation endpoint, as listed by GET /countries. */
export interface CountryParam {
  name: string;
  type: string;
  required: boolean;
  values?: string[];
  min?: number;
  max?: number;
  default?: string | number | boolean;
  unit?: string;
  /** API 1.7+: display name of each value (e.g. ca → California). */
  labels?: Record<string, string>;
  /** API 1.7+: accepted spellings (normalised with underscores) → canonical value. */
  aliases?: Record<string, string>;
  description: string;
}

export interface CalcEndpointInfo {
  path: string;
  calculatorUrl: string;
  parameters: CountryParam[];
}

export interface TaxTablesEndpointInfo {
  path: string;
  pageUrl: string;
  years: string[];
  current_year: string;
  years_available?: string[];
  latestPath?: string;
  regions: { code: string; name: string }[];
  formats?: string[];
}

export interface CountryInfo {
  code: string;
  /** API 1.7+: the short code used in docs (ISO 3166-1 alpha-2 in lower case; the UK is "uk"). */
  short_code?: string;
  /** API 1.7+: ISO 3166-1 alpha-2. */
  iso_code?: string;
  name: string;
  currency: string;
  current_year: string;
  years_available: string[];
  available_endpoints: string[];
  tables_only: boolean;
  /** API 1.8+: /supplemental-withholding is available (its parameters are in endpoints["supplemental-withholding"]). */
  supplemental?: boolean;
  /** API 1.8+: /equity-tax is available (its parameters are in equity_tax). */
  equity?: boolean;
  /** API 1.8+: the equity-tax endpoint (kept outside `endpoints`), or null. */
  equity_tax?: EquityEndpointInfo | null;
  /** API 1.9+: tax year, days remaining, upcoming changes and the next budget (GET /tax-calendar has the details). */
  tax_calendar?: CountryCalendarSummary;
  endpoints: {
    "net-salary"?: CalcEndpointInfo;
    "employer-cost"?: CalcEndpointInfo;
    "tax-tables": TaxTablesEndpointInfo;
    /** API 1.8+: present only where the country has supplemental withholding. */
    "supplemental-withholding"?: SupplementalEndpointInfo;
  };
}

/** API 1.8+: GET /supplemental-withholding for one country. */
export interface SupplementalEndpointInfo {
  path: string;
  /** Payment types the country supports (bonus, commission, rsu_vest, option_exercise, lump_sum). */
  types: string[];
  parameters: CountryParam[];
}

/** API 1.8+: GET /equity-tax for one country. */
export interface EquityEndpointInfo {
  path: string;
  /** Tax year of the rates (also accepted as `year`). */
  tax_year?: string;
  year?: string;
  instruments: string[];
  parameters: CountryParam[];
}

export interface Source {
  title?: string;
  url: string;
  retrievedAt?: string;
}

export interface TableRow {
  label: string;
  from?: number | null;
  to?: number | null;
  rate?: number | null;
  value?: number | string | null;
  unit?: string;
  note?: string;
  status?: string;
  source?: Source;
}

export interface TableSection {
  id: string;
  title: string;
  group: string;
  kind: string;
  rows: TableRow[];
  source?: Source;
  verified?: boolean;
  basis?: string;
  note?: string;
}

export interface TaxTable {
  country: string;
  countryName: string;
  year: string;
  yearLabel?: string;
  isCurrent?: boolean;
  region: { code: string; slug?: string; name: string } | null;
  currency: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  status?: string;
  underReview?: string[];
  dataVerified?: boolean;
  sections: TableSection[];
  sources?: Source[];
  current_year?: string;
  years_available?: string[];
  pageUrl: string;
  attribution?: Record<string, unknown>;
}

/** Response of /net-salary and /employer-cost. */
export interface CalcResponse {
  endpoint: string;
  country: string;
  countryName: string;
  year: string;
  requested_year?: string;
  currency: string;
  inputs: Record<string, unknown>;
  summary: Record<string, number | null>;
  results: Record<string, number>;
  breakdown: { title: string; columns: string[]; rows: { label: string; values: number[] }[] } | null;
  notes: string[];
  calculatorUrl: string;
  warnings: string[];
  attribution?: { url?: string; text?: string };
}

export interface CompareSide {
  country: string;
  place: string;
  currency: string;
  gross: number;
  incomeTax: number;
  contributions: number;
  retained: number;
  net: number;
  effectiveRate: number;
  grossInOtherCurrency: number;
  netInOtherCurrency: number;
  parts: { label: string; amount: number }[];
  assumptions: string[];
}

export interface CompareResponse {
  endpoint: string;
  inputs: Record<string, unknown>;
  a: CompareSide;
  b: CompareSide;
  exchangeRate: Record<string, unknown> & { date?: string; note?: string };
  difference: { inACurrency: number; inBCurrency: number; percentOfA: number; deductionRateGapPoints: number };
  interpretation: string;
  calculatorUrl: string;
  warnings: string[];
  attribution?: { url?: string; text?: string };
}

/** API 1.8+: an official source as the supplemental and equity endpoints return it. */
export interface ResultSource extends Source {
  effectiveFrom?: string;
  effectiveTo?: string | null;
}

/** API 1.8+: one line of GET /supplemental-withholding (withholding next to the final liability the payment adds). */
export interface SupplementalLine {
  label: string;
  withheld: number;
  liability: number | null;
  rate?: number;
  note?: string;
  source: ResultSource;
}

/** API 1.8+: response of GET /supplemental-withholding. */
export interface SupplementalResponse {
  endpoint: string;
  country: string;
  short_code?: string;
  countryName: string;
  year: string;
  currency: string;
  inputs: Record<string, unknown>;
  type: string;
  region: string | null;
  method: string;
  lines: SupplementalLine[];
  summary: { amount: number; totalWithheld: number; totalLiability: number | null; difference: number | null; netPayment: number };
  notes: string[];
  sources: ResultSource[];
  warnings: string[];
  attribution?: { url?: string; text?: string };
}

/** API 1.8+: one line of an equity-tax result (stage "event" = vest or exercise, "sale" = capital gains). */
export interface EquityLine {
  label: string;
  stage: "event" | "sale";
  base: number;
  amount: number;
  rate?: number;
  withheld?: number;
  note?: string;
  source: ResultSource;
}

export interface EquityScenario {
  name: string;
  description: string;
  totalTax: number;
  lines: EquityLine[];
}

/** API 1.8+: the EquityResult of GET /equity-tax (src/lib/equity/types.ts in the site repo). */
export interface EquityResult {
  country: string;
  region: string | null;
  taxYear: string;
  currency: string;
  instrument: string;
  units: number;
  taxableAtEvent: number;
  lines: EquityLine[];
  totalTaxAtEvent: number;
  totalTaxAtSale: number | null;
  flags: string[];
  scenarios: EquityScenario[];
  notes: string[];
  sources: ResultSource[];
}

/** API 1.8+: response of GET /equity-tax. */
export interface EquityResponse {
  endpoint: string;
  country: string;
  short_code?: string;
  countryName: string;
  year: string;
  currency: string;
  inputs: Record<string, unknown>;
  result: EquityResult;
  warnings: string[];
  attribution?: { url?: string; text?: string };
}

/* -------------------------------------------------- API 1.9: trade, tax calendar, cross-border equity -------------------------------------------------- */

/** A duty as the trade endpoints return it: a parsed expression, the tariff's own wording and a plain-English form. */
export interface TradeMeasure {
  measure_type: string;
  measure_type_description: string;
  geographical_area: string;
  geographical_area_description: string;
  excluded?: string[];
  agreement: string | null;
  additional_code: { code: string; description: string } | null;
  quota: { order_number: string; volume: number | null; unit: string | null; period_start: string | null; period_end: string | null } | null;
  duty: Record<string, unknown>;
  duty_text: string;
  duty_described: string;
  conditions: unknown[] | null;
  documents?: string[];
  extra_type: string | null;
  legal_acts: { code: string; title: string; url: string | null }[];
  valid_from: string;
  valid_to: string | null;
}

/** The tariff a trade response was read from (UK Trade Tariff, TARIC, HTSUS, India's First Schedule). */
export interface TariffMeta {
  destination: string;
  nomenclature: string;
  version: string;
  as_of: string;
  retrieved_at: string;
  publisher: string;
  source: string;
  api?: string;
  licence: string;
}

export interface TradeOrigin {
  iso: string;
  geo: string;
  name: string;
}

/** One line of GET /tariffs. */
export interface TariffLine {
  code: string;
  description: string;
  path: string[];
  supplementary_unit: string | null;
  mfn: { duty: Record<string, unknown>; duty_text: string; duty_described: string };
  third_country: TradeMeasure[];
  preferential: TradeMeasure[];
  best_preferential: TradeMeasure | null;
  suspensions: TradeMeasure[];
  quotas: TradeMeasure[];
  extra_duties: TradeMeasure[];
  surcharges?: TradeMeasure[];
  import_vat: TradeMeasure[];
  excise: TradeMeasure[];
  other_charges?: TradeMeasure[];
  valid_from?: string;
  valid_to?: string | null;
  source: string;
  page: string;
  footnotes?: { columns?: string[]; text: string }[];
  notes?: ({ text: string } | string)[];
}

/** API 1.9+: response of GET /tariffs. */
export interface TariffsResponse {
  tariff: TariffMeta;
  origin: TradeOrigin | null;
  filters: Record<string, string>;
  total: number;
  count: number;
  limit?: number;
  next_cursor: string | null;
  lines: TariffLine[];
  attribution?: { url?: string; text?: string };
}

/** API 1.9+: one record of GET /trade-agreements. */
export interface TradeAgreement {
  id: string;
  title: string;
  type: string;
  parties: string[];
  signed: string | null;
  in_force: string | null;
  direction: { destination: string; origins: string[] };
  geographical_areas: string[];
  scheme_code?: string;
  rules_of_origin: { summary: string; source: { id: string; url?: string; title?: string; publisher?: string; retrieved_at?: string } };
  links?: { text: string; url: string }[];
  sources: { id: string; url?: string; title?: string; publisher?: string; retrieved_at?: string }[];
}

export interface TradeAgreementsResponse {
  tariff: TariffMeta;
  partner: TradeOrigin | null;
  count: number;
  agreements: TradeAgreement[];
  attribution?: { url?: string; text?: string };
}

/** API 1.9+: one line of the GET /import-duty breakdown. */
export interface ImportDutyLine {
  kind: string;
  label: string;
  measure: TradeMeasure | null;
  base: number | null;
  base_description: string;
  amount: number | null;
  not_computed: string | null;
  source: string;
}

/** API 1.9+: response of GET /import-duty. */
export interface ImportDutyResponse {
  tariff: TariffMeta;
  member_state?: { code: string; name: string } | null;
  origin: TradeOrigin;
  line: { code: string; description: string; path: string[]; supplementary_unit: string | null; mfn?: string; source: string; page: string };
  inputs: Record<string, unknown>;
  mfn: { duty: Record<string, unknown>; duty_text: string; duty_described: string; amount: number | null; applied?: TradeMeasure | null };
  preferential: TradeMeasure | null;
  preferential_all: TradeMeasure[];
  preferential_quotas: TradeMeasure[];
  extra_duties_possible: TradeMeasure[];
  other_charges: TradeMeasure[];
  lines: ImportDutyLine[];
  totals: {
    customs_duty: number | null;
    extra_duties: number | null;
    excise: number | null;
    import_vat: number | null;
    fees?: number | null;
    duties_and_taxes: number | null;
    landed_cost: number | null;
    currency: string;
    complete: boolean;
    incomplete_reasons: string[];
  };
  notes: string[];
  basis: Record<string, { rule: string; source: string }>;
  disclaimer: string;
  warnings?: string[];
  attribution?: { url?: string; text?: string };
}

/** An official source as the tax calendar returns it. */
export interface CalendarSource {
  title: string;
  url: string;
  retrieved_at: string;
}

export interface CalendarChange {
  id: string;
  effective_from: string;
  date_precision: string;
  effective_to: string | null;
  title: string;
  detail: string | null;
  tax: string;
  section_id: string | null;
  region: { code: string; name: string } | null;
  status: string;
  origin: string;
  source: CalendarSource;
  quote: string | null;
}

/** API 1.9+: the calendar of GET /tax-calendar?country=. */
export interface TaxCalendar {
  country: string;
  country_name: string;
  region: { code: string; name: string } | null;
  as_of: string;
  tax_year: { label: string; display_label: string; start: string; end: string; type: string; days_remaining: number; data_year?: string };
  next_tax_year: { label: string; display_label: string; start: string; end: string } | null;
  other_periods?: { tax: string; label: string; start: string; end: string; source: CalendarSource; quote?: string }[];
  upcoming_changes: CalendarChange[];
  window: { from: string; to: string };
  next_budget: { status: string; event?: string; date?: string; source?: CalendarSource };
  last_budget: { event: string; date: string; source: CalendarSource; quote?: string } | null;
  next_year_note: { text: string; checked_at: string } | null;
  page_url: string;
}

export interface TaxCalendarResponse {
  as_of: string;
  calendar: TaxCalendar;
  attribution?: { url?: string; text?: string };
}

/** API 1.9+: the per-country tax calendar summary in GET /countries. */
export interface CountryCalendarSummary {
  tax_year: { label: string; start: string; end: string; type: string };
  days_remaining: number;
  next_tax_year: { label: string; start: string } | null;
  upcoming_changes: number;
  next_change: { effective_from: string; date_precision: string; title: string; status: string; region: string | { code: string; name: string } | null } | null;
  next_budget: { status: string; event?: string; date?: string };
  path: string;
}

/** API 1.8+: one fact of GET /facts. */
export interface TaxFact {
  id: string;
  country: string;
  country_code?: string;
  jurisdiction: string;
  level: string;
  tax_type: string;
  tax_group?: string;
  measure: string;
  value?: number | string | null;
  bands?: { label?: string; from: number; to: number | null; rate: number }[] | null;
  unit?: string;
  currency?: string;
  label?: string;
  basis?: string;
  note?: string;
  section_id?: string;
  section?: string;
  tax_year: string;
  valid_from: string;
  valid_to: string | null;
  status: string;
  applies_when?: string;
  source: { id?: string; url: string; title?: string; retrieved_at?: string; checked_at?: string };
  derived_from?: string;
}

export interface FactsResponse {
  filters: Record<string, string>;
  total: number;
  count: number;
  limit?: number;
  next_cursor: string | null;
  facts: TaxFact[];
  attribution?: { url?: string; text?: string };
}

/** API 1.9+: one country's share of GET /cross-border-equity. */
export interface CrossBorderCountry {
  country: string;
  covered: boolean;
  currency: string;
  workdays: number;
  workdayShare: number;
  method: string;
  methodLabel: string;
  oecdDefault: boolean;
  ruleIds?: string[];
  ruleStatus: string;
  sourceShare: number;
  basis: string;
  taxableShare: number;
  taxableAmount: number;
  taxableAmountLocal: number;
  isResidence: boolean;
  estimate: {
    engine: string;
    instrument: string;
    method: string;
    taxYear: string;
    taxableAmount: number;
    estimatedTax: number;
    withheld: number | null;
    lines: { label: string; amount: number; withheld?: number; rate?: number; note?: string }[];
    notes: string[];
    sources: ResultSource[];
  } | null;
  notes: string[];
  sources: ResultSource[];
}

/** API 1.9+: response of GET /cross-border-equity. */
export interface CrossBorderResponse {
  endpoint: string;
  estimate: boolean;
  inputs: Record<string, unknown>;
  result: {
    estimate: boolean;
    label: string;
    instrument: string;
    units: number;
    currency: string;
    totalIncome: number;
    sourcingPeriod: { start: string; end: string; weekdays: number };
    eventDate: string;
    residence: { country: string; how: string };
    grantCountry: { country: string; how: string };
    totalWorkdays: number;
    periods: { country: string; start: string; end: string; workdaysGiven: number | null; workdaysUsed: number; computed: boolean; clipped: boolean }[];
    countries: CrossBorderCountry[];
    relief: { source: string; other: string; overlap: number; kind: string; treaty: string; text: string; treatySource?: ResultSource }[];
    flags: string[];
    notes: string[];
    underReview: string[];
    fx: { referenceDate: string; source: ResultSource; rates: Record<string, number> };
    sources: ResultSource[];
  };
  warnings: string[];
  attribution?: { url?: string; text?: string };
}

export type QueryValue = string | number | boolean;

/** An error from the CalcBloc API (or from reaching it), with a message written for the person using the assistant. */
export class CalcBlocApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public docs?: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "CalcBlocApiError";
  }
}

/**
 * The API key from the environment: CALCBLOC_API_KEY, or CLAUDE_PLUGIN_OPTION_CALCBLOC_API_KEY, the name the Claude
 * plugin passes its optional `calcbloc_api_key` setting under. Empty values and placeholders that a client left
 * unsubstituted (such as "${user_config.calcbloc_api_key}") count as no key, so the free allowance is used instead
 * of failing every request with an invalid key.
 */
export function apiKeyFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  for (const name of ["CALCBLOC_API_KEY", "CLAUDE_PLUGIN_OPTION_CALCBLOC_API_KEY"]) {
    const value = env[name]?.trim();
    if (value && !/^\$\{[^}]*\}$/.test(value)) return value;
  }
  return undefined;
}

export interface ClientOptions {
  /** Base URL of the API, default https://calcbloc.com/api/v1. */
  apiUrl?: string;
  /** Free API key (sent as X-API-Key). */
  apiKey?: string;
  /** Folder with the calcbloc-data tables (manifest.json, <country>/<year>.json); tax tables are read from it first. */
  dataDir?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  cacheTtlMs?: number;
  /** Clock (ms), for tests. */
  now?: () => number;
}

interface Manifest {
  countries: {
    country: string;
    name: string;
    currency?: string;
    current_year: string;
    years: string[];
    regions?: { code: string; name: string; slug?: string }[];
    pageUrl?: string;
  }[];
}

export function humanDuration(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes`;
  return `${Math.round(seconds / 3600)} hours`;
}

/**
 * Small client for the CalcBloc public API (https://calcbloc.com/developers). Responses that rarely change
 * (country list, tax tables) are cached in memory so a conversation does not use up the daily request allowance.
 */
export class CalcBlocClient {
  readonly apiUrl: string;
  readonly hasApiKey: boolean;
  readonly dataDir?: string;
  /** Set when the last country-list request failed and the local manifest was used instead. */
  offlineReason?: string;
  /** API 1.9+: the day the cached country list (and its tax-calendar summaries) was computed for. */
  countriesAsOf?: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, { expires: number; value: Promise<unknown> }>();
  private manifest?: Promise<Manifest | null>;
  private readonly now: () => number;
  /**
   * After a 429, or once a request without a key reports X-RateLimit-Remaining: 0, no request is sent before this
   * time (ms): the tools answer with the limit message straight away instead of retrying.
   */
  private blockedUntil = 0;
  /** The daily request limit the API last reported (X-RateLimit-Limit). */
  private dailyLimit: number | undefined;

  constructor(opts: ClientOptions = {}) {
    // Trailing slashes are trimmed with a loop rather than /\/+$/, which is polynomial on long runs of "/".
    let apiUrl = opts.apiUrl || DEFAULT_API_URL;
    while (apiUrl.endsWith("/")) apiUrl = apiUrl.slice(0, -1);
    this.apiUrl = apiUrl;
    this.apiKey = opts.apiKey?.trim() || undefined;
    this.hasApiKey = !!this.apiKey;
    this.dataDir = opts.dataDir ? resolveDataDir(opts.dataDir) : undefined;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.cacheTtlMs = opts.cacheTtlMs ?? 6 * 60 * 60 * 1000;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * The rate-limit error. Without a key it says the free allowance is used up and asks for a free key, with where it
   * goes (CALCBLOC_API_KEY); with a key it is the key's limit and when to try again.
   */
  private limitError(retryAfter: number | undefined, docs?: string): CalcBlocApiError {
    const when = retryAfter ? ` Try again in about ${humanDuration(retryAfter)}.` : "";
    // Limits are not typed in here: the daily figure comes from the API's X-RateLimit-Limit header when it has been seen.
    const perDay = this.dailyLimit ? `${this.dailyLimit.toLocaleString("en-US")} requests a day` : "";
    const day = perDay ? ` (${perDay})` : "";
    if (this.apiKey)
      return new CalcBlocApiError(429, "rate_limited", `The CalcBloc API rate limit was reached.${when} Your API key's limits${perDay ? `: ${perDay}` : ""} are listed at ${DEVELOPERS_URL}#limits.`, docs, retryAfter);
    const addKey = ` Get a free API key (email only, much higher limits): ${API_KEY_URL_APP} and set it as the CALCBLOC_API_KEY environment variable in this MCP server's configuration (the "env" block for calcbloc in your MCP client's settings), then restart the server.`;
    const message =
      retryAfter !== undefined && retryAfter <= 60
        ? `The free per-minute allowance without a key is used up for this minute.${when}${addKey}`
        : `The free daily allowance without a key${day} is used up.${addKey}${retryAfter ? ` Without a key, try again in about ${humanDuration(retryAfter)}.` : ""}`;
    return new CalcBlocApiError(429, "rate_limited", message, docs, retryAfter);
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): CalcBlocClient {
    return new CalcBlocClient({
      apiUrl: env.CALCBLOC_API_URL,
      apiKey: apiKeyFromEnv(env),
      dataDir: env.CALCBLOC_DATA_DIR,
      timeoutMs: env.CALCBLOC_TIMEOUT_MS ? Number(env.CALCBLOC_TIMEOUT_MS) : undefined,
    });
  }

  /** Every live country with its tax years, regions and per-endpoint parameters (cached). */
  async countries(): Promise<CountryInfo[]> {
    try {
      const body = await this.cached("countries", () => this.get<{ countries: CountryInfo[]; as_of?: string }>("/countries"));
      this.offlineReason = undefined;
      this.countriesAsOf = body.as_of;
      return body.countries;
    } catch (e) {
      // API unreachable but a local data folder is set: tax tables still work, from the folder's manifest.
      const manifest = await this.loadManifest();
      if (!manifest) throw e;
      this.offlineReason = e instanceof Error ? e.message : String(e);
      return manifest.countries.map(manifestCountry);
    }
  }

  netSalary(params: Record<string, QueryValue>): Promise<CalcResponse> {
    return this.get<CalcResponse>("/net-salary", params);
  }

  employerCost(params: Record<string, QueryValue>): Promise<CalcResponse> {
    return this.get<CalcResponse>("/employer-cost", params);
  }

  compare(params: Record<string, QueryValue>): Promise<CompareResponse> {
    return this.get<CompareResponse>("/compare", params);
  }

  /** API 1.8+: tax withheld on a bonus or other supplemental payment, next to the final liability it adds. */
  supplementalWithholding(params: Record<string, QueryValue>): Promise<SupplementalResponse> {
    return this.get<SupplementalResponse>("/supplemental-withholding", params);
  }

  /** API 1.8+: tax on an RSU vest or option exercise, and on a later sale. */
  equityTax(params: Record<string, QueryValue>): Promise<EquityResponse> {
    return this.get<EquityResponse>("/equity-tax", params);
  }

  /** API 1.9+: an RSU vest or option exercise split between the countries worked in, with each share's estimated tax. */
  crossBorderEquity(params: Record<string, QueryValue>): Promise<CrossBorderResponse> {
    return this.get<CrossBorderResponse>("/cross-border-equity", params);
  }

  /** API 1.9+: duties and taxes on one import (landed cost). */
  importDuty(params: Record<string, QueryValue>): Promise<ImportDutyResponse> {
    return this.get<ImportDutyResponse>("/import-duty", params);
  }

  /** API 1.9+: tariff lines by commodity code (cached: the tariffs change with each tariff version only). */
  tariffs(params: Record<string, QueryValue>): Promise<TariffsResponse> {
    return this.cached(`tariffs:${queryKey(params)}`, () => this.get<TariffsResponse>("/tariffs", params));
  }

  /** API 1.9+: agreements and preference schemes in a country's tariff (cached). */
  tradeAgreements(params: Record<string, QueryValue>): Promise<TradeAgreementsResponse> {
    return this.cached(`agreements:${queryKey(params)}`, () => this.get<TradeAgreementsResponse>("/trade-agreements", params));
  }

  /** API 1.9+: tax year, next tax year and upcoming changes for a country. */
  taxCalendar(params: Record<string, QueryValue>): Promise<TaxCalendarResponse> {
    return this.get<TaxCalendarResponse>("/tax-calendar", params);
  }

  /** API 1.8+: tax-table figures as facts, filtered and paginated (cached). */
  facts(params: Record<string, QueryValue>): Promise<FactsResponse> {
    return this.cached(`facts:${queryKey(params)}`, () => this.get<FactsResponse>("/facts", params));
  }

  /** A tax table (national, or regional when `region` is a region code). Local data first when a data folder is set. */
  async taxTable(country: string, year = "latest", region?: string): Promise<{ table: TaxTable; origin: "api" | "local" }> {
    const key = `table:${country}:${year}:${region ?? ""}`;
    return this.cached(key, async () => {
      const local = await this.localTable(country, year, region);
      if (local) return { table: local, origin: "local" as const };
      const table = await this.get<TaxTable>(
        `/tax-tables/${encodeURIComponent(country)}/${encodeURIComponent(year)}`,
        region ? { region } : undefined,
      );
      return { table, origin: "api" as const };
    });
  }

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
    const value = load();
    this.cache.set(key, { expires: Date.now() + this.cacheTtlMs, value });
    // Failed loads are not cached.
    value.catch(() => {
      if (this.cache.get(key)?.value === value) this.cache.delete(key);
    });
    return value;
  }

  private async get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    const url = new URL(this.apiUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": `${SERVER_NAME}/${SERVER_VERSION} (+https://github.com/itmarkerz/calcbloc-mcp)`,
    };
    if (this.apiKey) headers["X-API-Key"] = this.apiKey;
    const waitMs = this.blockedUntil - this.now();
    if (waitMs > 0) throw this.limitError(Math.ceil(waitMs / 1000));

    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      throw new CalcBlocApiError(0, "network_error", `Could not reach the CalcBloc API at ${this.apiUrl} (${reason}).`);
    }
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new CalcBlocApiError(res.status, "invalid_response", `The CalcBloc API returned a response that is not JSON (HTTP ${res.status}).`);
    }
    const dayLimit = Number(res.headers.get("x-ratelimit-limit"));
    if (Number.isInteger(dayLimit) && dayLimit > 0) this.dailyLimit = dayLimit;
    if (res.ok) {
      // Last keyless request of the day: the next ones would get 429, so ask for a key instead of sending them.
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (!this.apiKey && remaining !== null && remaining.trim() !== "" && Number(remaining) <= 0) {
        const reset = Number(res.headers.get("x-ratelimit-reset"));
        this.blockedUntil = this.now() + (Number.isFinite(reset) && reset > 0 ? reset : 3600) * 1000;
      }
      return body as T;
    }

    const err = (body as { error?: { code?: string; message?: string; docs?: string } }).error ?? {};
    const retry = Number(res.headers.get("retry-after"));
    const retryAfter = Number.isFinite(retry) && retry > 0 ? retry : undefined;
    if (res.status === 429 || err.code === "rate_limited") {
      this.blockedUntil = this.now() + (retryAfter ?? 60) * 1000;
      throw this.limitError(retryAfter, err.docs);
    }
    if (err.code === "invalid_key" || err.code === "api_key_required") {
      throw new CalcBlocApiError(
        res.status,
        err.code,
        `${err.message ?? "The API key was not accepted."} Check CALCBLOC_API_KEY, or get a free key at ${API_KEY_URL_APP}.`,
        err.docs,
      );
    }
    throw new CalcBlocApiError(res.status, err.code ?? `http_${res.status}`, err.message ?? `The CalcBloc API returned HTTP ${res.status}.`, err.docs, retryAfter);
  }

  private async loadManifest(): Promise<Manifest | null> {
    if (!this.dataDir) return null;
    this.manifest ??= readFile(join(this.dataDir, "manifest.json"), "utf8")
      .then((t) => JSON.parse(t) as Manifest)
      .catch(() => null);
    return this.manifest;
  }

  private async localTable(country: string, year: string, region?: string): Promise<TaxTable | null> {
    const manifest = await this.loadManifest();
    if (!manifest || !this.dataDir) return null;
    const entry = manifest.countries.find((c) => c.country === country);
    if (!entry) return null;
    const y = year === "latest" ? entry.current_year : year;
    if (!entry.years.includes(y)) return null;
    let file = join(this.dataDir, country, `${y}.json`);
    if (region) {
      const r = entry.regions?.find((x) => x.code === region || x.slug === region);
      if (!r) return null;
      file = join(this.dataDir, country, y, `${r.code}.json`);
    }
    try {
      return JSON.parse(await readFile(file, "utf8")) as TaxTable;
    } catch {
      return null;
    }
  }
}

/** A stable cache key for a query (parameters sorted). */
function queryKey(params: Record<string, QueryValue>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join("&");
}

/** A tables-only country entry built from the local manifest (used when the API cannot be reached). */
function manifestCountry(c: Manifest["countries"][number]): CountryInfo {
  const pageUrl = c.pageUrl ?? `https://calcbloc.com/${c.country}/tax-tables/${c.current_year}`;
  return {
    code: c.country,
    name: c.name,
    currency: c.currency ?? "",
    current_year: c.current_year,
    years_available: c.years,
    available_endpoints: ["tax-tables"],
    tables_only: true,
    endpoints: {
      "tax-tables": {
        path: `/api/v1/tax-tables/${c.country}/${c.current_year}`,
        pageUrl,
        years: c.years,
        current_year: c.current_year,
        regions: (c.regions ?? []).map((r) => ({ code: r.code, name: r.name })),
      },
    },
  };
}

/** Accepts either the calcbloc-data repository root or its tables/ folder. */
function resolveDataDir(dir: string): string {
  if (existsSync(join(dir, "manifest.json"))) return dir;
  if (existsSync(join(dir, "tables", "manifest.json"))) return join(dir, "tables");
  return dir;
}
