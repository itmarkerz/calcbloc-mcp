import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { API_KEY_URL, DEFAULT_API_URL, SERVER_NAME, SERVER_VERSION } from "./constants.js";

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
  name: string;
  currency: string;
  current_year: string;
  years_available: string[];
  available_endpoints: string[];
  tables_only: boolean;
  endpoints: {
    "net-salary"?: CalcEndpointInfo;
    "employer-cost"?: CalcEndpointInfo;
    "tax-tables": TaxTablesEndpointInfo;
  };
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
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, { expires: number; value: Promise<unknown> }>();
  private manifest?: Promise<Manifest | null>;

  constructor(opts: ClientOptions = {}) {
    this.apiUrl = (opts.apiUrl || DEFAULT_API_URL).replace(/\/+$/, "");
    this.apiKey = opts.apiKey?.trim() || undefined;
    this.hasApiKey = !!this.apiKey;
    this.dataDir = opts.dataDir ? resolveDataDir(opts.dataDir) : undefined;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.cacheTtlMs = opts.cacheTtlMs ?? 6 * 60 * 60 * 1000;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): CalcBlocClient {
    return new CalcBlocClient({
      apiUrl: env.CALCBLOC_API_URL,
      apiKey: env.CALCBLOC_API_KEY,
      dataDir: env.CALCBLOC_DATA_DIR,
      timeoutMs: env.CALCBLOC_TIMEOUT_MS ? Number(env.CALCBLOC_TIMEOUT_MS) : undefined,
    });
  }

  /** Every live country with its tax years, regions and per-endpoint parameters (cached). */
  async countries(): Promise<CountryInfo[]> {
    try {
      const body = await this.cached("countries", () => this.get<{ countries: CountryInfo[] }>("/countries"));
      this.offlineReason = undefined;
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
    if (res.ok) return body as T;

    const err = (body as { error?: { code?: string; message?: string; docs?: string } }).error ?? {};
    const retry = Number(res.headers.get("retry-after"));
    const retryAfter = Number.isFinite(retry) && retry > 0 ? retry : undefined;
    if (res.status === 429 || err.code === "rate_limited") {
      const when = retryAfter ? ` Try again in about ${humanDuration(retryAfter)}.` : "";
      const advice = this.apiKey
        ? " Your API key's limit is 5,000 requests a day and 60 a minute."
        : ` Anonymous use is limited to 50 requests a day and 5 a minute per IP address. A free API key raises this to 5,000 a day: get one at ${API_KEY_URL} and set it as CALCBLOC_API_KEY in the MCP server's environment.`;
      throw new CalcBlocApiError(429, "rate_limited", `The CalcBloc API rate limit was reached.${when}${advice}`, err.docs, retryAfter);
    }
    if (err.code === "invalid_key" || err.code === "api_key_required") {
      throw new CalcBlocApiError(
        res.status,
        err.code,
        `${err.message ?? "The API key was not accepted."} Check CALCBLOC_API_KEY, or get a free key at ${API_KEY_URL}.`,
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
