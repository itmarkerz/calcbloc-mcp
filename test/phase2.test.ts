import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as z from "zod/v4";
import { CalcBlocClient, type CountryInfo } from "../src/api.js";
import { NOT_SUPPORTED, NOT_YET_SUPPORTED } from "../src/constants.js";
import { COVERAGE } from "../src/coverage.generated.js";
import { equityTax, listCountries, registerTools, supplementalWithholding } from "../src/tools.js";
import { mockFetch, type MockReply } from "./mock-api.js";

/**
 * 0.3.0 (master build Phase 2): calculate_supplemental_withholding and calculate_equity_tax on API 1.8. The fixtures
 * are captured from the site repo's local main (handleApiRequest with an in-memory store), since 1.8.0 is not live yet.
 */
const client = (override?: (url: URL) => MockReply | undefined) => {
  const m = mockFetch(override);
  return { api: new CalcBlocClient({ apiUrl: "https://calcbloc.test/api/v1", fetch: m.fetch }), calls: m.calls };
};
const text = (r: { content: { text: string }[] }) => r.content.map((c) => c.text).join("\n");
const load = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const fixture = load("countries.json") as { countries: CountryInfo[]; coverage: Record<string, unknown> };
const sc = (r: { structuredContent?: Record<string, unknown> }) => r.structuredContent as Record<string, any>;

type Tool = { name: string; description: string; inputSchema: z.ZodType; outputSchema: z.ZodType };
function tools(): Tool[] {
  const out: Tool[] = [];
  const fake = { registerTool: (name: string, def: Omit<Tool, "name">) => out.push({ name, ...def }) };
  registerTools(fake as never, client().api);
  return out;
}
const tool = (name: string) => tools().find((t) => t.name === name)!;
type JsonSchema = { properties: Record<string, { enum?: string[]; description?: string; pattern?: string }>; required?: string[] };
const schema = (name: string) => z.toJSONSchema(tool(name).inputSchema) as JsonSchema;

/**
 * MCP clients validate structured content against the JSON Schema of the output (objects have additionalProperties
 * false), which zod's safeParse does not catch: list every key the schema does not declare.
 */
type Js = { anyOf?: Js[]; properties?: Record<string, Js>; additionalProperties?: boolean | Js; items?: Js };
function undeclared(schema: Js, value: unknown, path = ""): string[] {
  if (schema.anyOf) {
    const each = schema.anyOf.map((s) => undeclared(s, value, path));
    return each.some((e) => !e.length) ? [] : each[0]!;
  }
  if (Array.isArray(value)) return schema.items ? value.flatMap((v, i) => undeclared(schema.items!, v, `${path}/${i}`)) : [];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => {
      const sub = schema.properties?.[k];
      if (sub) return undeclared(sub, v, `${path}/${k}`);
      if (schema.additionalProperties === false) return [`${path}/${k}`];
      return typeof schema.additionalProperties === "object" ? undeclared(schema.additionalProperties, v, `${path}/${k}`) : [];
    });
  }
  return [];
}
const conforms = (name: string, value: unknown) => {
  const t = tool(name);
  expect(t.outputSchema.safeParse(value).success).toBe(true);
  expect(undeclared(z.toJSONSchema(t.outputSchema) as Js, value)).toEqual([]);
};

const SUPP = "calculate_supplemental_withholding";
const EQUITY = "calculate_equity_tax";
const ukEmi = {
  country: "uk",
  instrument: "emi",
  units: 1000,
  grant_date: "2022-05-01",
  event_date: "2026-06-01",
  fmv_grant: 5,
  fmv_event: 12,
  exercise_price: 3,
  gross_salary: 30000,
  options: { readily_convertible: false },
};

describe("schema: coverage generated from /countries (API 1.8)", () => {
  it("lists the supplemental and equity countries, instruments and region requirements from the fixture", () => {
    const supp = fixture.countries.filter((c) => c.endpoints["supplemental-withholding"]);
    const eq = fixture.countries.filter((c) => c.equity_tax);
    expect(COVERAGE.supplementalCountries).toEqual(supp.map((c) => c.short_code));
    expect(COVERAGE.supplementalCountries).toEqual(fixture.coverage.supplemental_countries);
    expect(COVERAGE.equityCountries).toEqual(fixture.coverage.equity_countries);
    expect(COVERAGE.supplemental).toBe(fixture.coverage.supplemental);
    expect(COVERAGE.equity).toBe(fixture.coverage.equity);
    for (const c of eq) expect((COVERAGE.equityInstruments as Record<string, readonly string[]>)[c.short_code!]).toEqual(c.equity_tax!.instruments);
    for (const c of supp) expect((COVERAGE.supplementalTypes as Record<string, readonly string[]>)[c.short_code!]).toEqual(c.endpoints["supplemental-withholding"]!.types);
    expect(COVERAGE.regionRequiredExtra["supplemental-withholding"]).toEqual(["us", "ca"]);
    expect(COVERAGE.regionRequiredExtra["equity-tax"]).toEqual(["ca"]);
  });

  it("descriptions name the countries, the region requirement and the scope", () => {
    const s = tool(SUPP).description;
    expect(s).toContain(`Countries: ${COVERAGE.supplementalCountries.join(", ")}.`);
    expect(s).toContain(`region is REQUIRED for: ${COVERAGE.regionRequiredExtra["supplemental-withholding"].join(", ")}`);
    expect(s).toContain("au (bonus, commission, lump_sum)");
    expect(s).toContain(NOT_YET_SUPPORTED);
    const e = tool(EQUITY).description;
    for (const c of COVERAGE.equityCountries) expect(e).toContain(`${c} (`);
    expect(e).toContain("us (rsu, nso, iso)");
    expect(e).toContain("uk (rsu, emi, csop, unapproved_option)");
    expect(e).toContain(`region is REQUIRED for: ${COVERAGE.regionRequiredExtra["equity-tax"].join(", ")}`);
    expect(e).toContain(NOT_YET_SUPPORTED);
    // No hard-coded country counts.
    for (const d of [s, e]) expect(d).not.toMatch(/\b\d+ countries\b/);
  });

  it("required parameters and enums for type and instrument", () => {
    const s = schema(SUPP);
    expect(s.required).toEqual(["country", "gross_salary", "amount"]);
    expect(s.properties.type?.enum).toEqual(["bonus", "commission", "rsu_vest", "option_exercise", "lump_sum"]);
    expect(s.properties.region?.description).toContain("Required for: us, ca");
    const e = schema(EQUITY);
    expect(e.required).toEqual(["country", "instrument", "units", "grant_date", "event_date", "fmv_event", "gross_salary"]);
    expect(e.properties.instrument?.enum).toEqual([...COVERAGE.equityInstrumentValues]);
    expect(e.properties.instrument?.enum).toEqual(expect.arrayContaining(["rsu", "nso", "iso", "emi", "csop", "unapproved_option", "esop", "stock_option", "ess_upfront", "ess_deferred"]));
    expect(e.properties.grant_date?.pattern).toBeDefined();
    expect(e.properties.region?.description).toContain("Required for: ca");
  });

  it("option examples in the descriptions are real parameters of those countries", () => {
    const params = (code: string, kind: "supp" | "equity") => {
      const c = fixture.countries.find((x) => x.code === code)!;
      return (kind === "supp" ? c.endpoints["supplemental-withholding"]!.parameters : c.equity_tax!.parameters).map((p) => p.name);
    };
    for (const n of ["filing_status", "method", "ytd_supplemental"]) expect(params("us", "supp")).toContain(n);
    for (const n of ["tax_code_number", "month_paid"]) expect(params("uk", "supp")).toContain(n);
    for (const n of ["tax_class", "church"]) expect(params("germany", "supp")).toContain(n);
    expect(params("us", "equity")).toContain("filing_status");
    for (const n of ["readily_convertible", "emi_exercise_period_years"]) expect(params("uk", "equity")).toContain(n);
    expect(params("canada", "equity")).toContain("employer_type");
    for (const n of ["regime", "listed"]) expect(params("india", "equity")).toContain(n);
  });

  it("the scope note says supplemental and equity are supported and cross-border is not", () => {
    expect(NOT_SUPPORTED).toContain(`calculate_supplemental_withholding (${COVERAGE.supplementalCountries.join(", ")})`);
    expect(NOT_SUPPORTED).toContain(`calculate_equity_tax (${COVERAGE.equityCountries.join(", ")})`);
    expect(NOT_SUPPORTED).toContain("Not yet supported: cross-border (multi-country) withholding.");
    expect(NOT_SUPPORTED).not.toMatch(/Not yet supported: equity|bonus and supplemental withholding, and/);
    for (const n of ["calculate_take_home_pay", "calculate_employer_cost", "compare_countries"]) expect(tool(n).description).toContain(NOT_SUPPORTED);
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const block = readme.slice(readme.indexOf("<!-- coverage:start -->"), readme.indexOf("<!-- coverage:end -->"));
    expect(block).toContain("`calculate_supplemental_withholding`");
    expect(block).toContain("`calculate_equity_tax`");
    expect(block).toContain(NOT_YET_SUPPORTED);
  });
});

describe("behaviour: supplemental withholding", () => {
  it("resolves country names, region names and option aliases, sending canonical values", async () => {
    const { api, calls } = client();
    const r = await supplementalWithholding(api, { country: "United States", region: "California", gross_salary: 150000, amount: 10000, type: "bonus", options: { filingStatus: "Single or married filing separately", method: "Optional flat rate (method 1a)" } });
    expect(r.isError, text(r)).toBeFalsy();
    const q = calls.find((c) => c.path === "/supplemental-withholding")!.query;
    expect(q).toMatchObject({ country: "us", region: "ca", salary: "150000", amount: "10000", type: "bonus", filing_status: "single", method: "flat" });
    const { api: api2, calls: calls2 } = client();
    await supplementalWithholding(api2, { country: "usa", region: "CA", gross_salary: 150000, amount: 10000, options: { filing_status: "married" } });
    expect(calls2.find((c) => c.path === "/supplemental-withholding")!.query.filing_status).toBe("mfj");
  });

  it("accepts type aliases from the API (rsu → rsu_vest) for direct callers", async () => {
    const { api, calls } = client();
    await supplementalWithholding(api, { country: "us", region: "ca", gross_salary: 150000, amount: 10000, type: "rsu" });
    expect(calls.find((c) => c.path === "/supplemental-withholding")!.query.type).toBe("rsu_vest");
  });

  it("a US or Canadian payment without region fails before calling the API and lists the codes", async () => {
    for (const [country, code] of [["us", "ca (California)"], ["ca", "on (Ontario)"]] as const) {
      const { api, calls } = client();
      const r = await supplementalWithholding(api, { country, gross_salary: 100000, amount: 10000 });
      expect(r.isError).toBe(true);
      expect(text(r)).toContain("supplemental withholding needs a region");
      expect(text(r)).toContain(code);
      expect(calls.filter((c) => c.path === "/supplemental-withholding")).toHaveLength(0);
    }
  });

  it("an unknown region or option lists the valid ones", async () => {
    const { api } = client();
    const r = await supplementalWithholding(api, { country: "us", region: "Narnia", gross_salary: 100000, amount: 1000 });
    expect(text(r)).toContain('Unknown United States region "Narnia"');
    const o = await supplementalWithholding(api, { country: "uk", gross_salary: 50000, amount: 1000, options: { student_loan: "plan2" } });
    expect(o.isError).toBe(true);
    expect(text(o)).toContain("is not an option for United Kingdom (supplemental withholding)");
    expect(text(o)).toContain("tax_code_number");
    const reserved = await supplementalWithholding(api, { country: "uk", gross_salary: 50000, amount: 1000, options: { salary: 1 } });
    expect(text(reserved)).toContain('Pass "gross_salary" as its own argument');
  });

  it("a payment type the country does not take returns its supported types without calling the API", async () => {
    const { api, calls } = client();
    const r = await supplementalWithholding(api, { country: "au", gross_salary: 100000, amount: 10000, type: "rsu_vest" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('Payment type "rsu_vest" is not available for Australia');
    expect(text(r)).toContain("bonus (Bonus), commission (Commission), lump_sum (Lump sum)");
    expect(calls.filter((c) => c.path === "/supplemental-withholding")).toHaveLength(0);
  });

  it("an unsupported country names the supported ones from /countries and links its tax tables", async () => {
    const { api, calls } = client();
    const r = await supplementalWithholding(api, { country: "Italy", gross_salary: 50000, amount: 1000 });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Supplemental withholding is not available for Italy yet");
    expect(text(r)).toContain("us (United States)");
    expect(text(r)).toContain("nz (New Zealand)");
    expect(text(r)).toContain("calcbloc.com/italy/tax-tables/");
    expect(calls.filter((c) => c.path === "/supplemental-withholding")).toHaveLength(0);
  });

  it("against an API before 1.8 says the endpoint needs 1.8", async () => {
    const old = load("countries.json");
    for (const c of old.countries) {
      delete c.endpoints["supplemental-withholding"];
      delete c.equity_tax;
    }
    const { api } = client((u) => (u.pathname.endsWith("/countries") ? { status: 200, body: old } : undefined));
    const r = await supplementalWithholding(api, { country: "uk", gross_salary: 50000, amount: 1000 });
    expect(text(r)).toContain("needs API 1.8 or later");
    const e = await equityTax(api, { ...ukEmi });
    expect(text(e)).toContain("needs API 1.8 or later");
  });

  it("passes API errors through as tool errors", async () => {
    const { api } = client((u) => (u.pathname.endsWith("/supplemental-withholding") ? { status: 400, body: load("supplemental-unsupported-type.json") } : undefined));
    const r = await supplementalWithholding(api, { country: "uk", gross_salary: 50000, amount: 1000 });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("CalcBloc API error [invalid_parameter]");
  });
});

describe("behaviour: equity tax", () => {
  it("resolves instrument labels and aliases, region labels and boolean options", async () => {
    const { api, calls } = client();
    const r = await equityTax(api, { ...ukEmi, instrument: "Enterprise Management Incentives", region: "England & Northern Ireland", options: { readily_convertible: "no", emi_exercise_period_years: 10 } });
    expect(r.isError, text(r)).toBeFalsy();
    const q = calls.find((c) => c.path === "/equity-tax")!.query;
    expect(q).toMatchObject({ country: "uk", instrument: "emi", region: "england", readily_convertible: "false", emi_exercise_period_years: "10", salary: "30000", fmv_grant: "5", exercise_price: "3" });
    expect(q).not.toHaveProperty("sale_price");
    const { api: api2, calls: calls2 } = client();
    await equityTax(api2, { country: "us", instrument: "incentive_stock_option", units: 100, grant_date: "2023-03-12", event_date: "2024-01-07", exercise_price: 10, fmv_event: 12, sale_price: 15, sale_date: "2025-01-27", gross_salary: 100000 });
    expect(calls2.find((c) => c.path === "/equity-tax")!.query.instrument).toBe("iso");
  });

  it("an instrument from another country returns this country's instruments", async () => {
    const { api, calls } = client();
    const r = await equityTax(api, { ...ukEmi, instrument: "iso" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('Instrument "iso" is not available for United Kingdom');
    expect(text(r)).toContain("emi (Enterprise Management Incentives (EMI) options)");
    expect(calls.filter((c) => c.path === "/equity-tax")).toHaveLength(0);
  });

  it("Canada requires a province, checked before calling the API", async () => {
    const { api, calls } = client();
    const r = await equityTax(api, { country: "canada", instrument: "stock_option", units: 100, grant_date: "2024-01-01", event_date: "2026-01-01", exercise_price: 10, fmv_event: 20, gross_salary: 90000 });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Canada equity tax needs a region");
    expect(text(r)).toContain("on (Ontario)");
    expect(calls.filter((c) => c.path === "/equity-tax")).toHaveLength(0);
  });

  it("checks the sale pair and the date order before calling the API", async () => {
    const { api, calls } = client();
    expect(text(await equityTax(api, { ...ukEmi, sale_price: 20 }))).toContain("sale_price and sale_date go together");
    expect(text(await equityTax(api, { ...ukEmi, event_date: "2021-01-01" }))).toContain("cannot be before grant_date");
    expect(text(await equityTax(api, { ...ukEmi, sale_price: 20, sale_date: "2026-01-01" }))).toContain("cannot be before event_date");
    expect(calls.filter((c) => c.path === "/equity-tax")).toHaveLength(0);
  });

  it("an unsupported country names the supported ones from /countries", async () => {
    const { api, calls } = client();
    const r = await equityTax(api, { ...ukEmi, country: "de", instrument: "rsu" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Equity tax is not available for Germany yet. Countries with equity tax: us (United States), uk (United Kingdom), au (Australia), ca (Canada), in (India).");
    expect(text(r)).toContain("Take-home pay (calculate_take_home_pay) is available for it.");
    expect(calls.filter((c) => c.path === "/equity-tax")).toHaveLength(0);
  });

  it("passes the API's missing-parameter error through", async () => {
    const { api } = client((u) => (u.pathname.endsWith("/equity-tax") ? { status: 400, body: load("equity-missing-parameter.json") } : undefined));
    const r = await equityTax(api, { ...ukEmi });
    expect(text(r)).toContain('CalcBloc API error [missing_parameter]: Parameter "fmv_event" is required.');
  });
});

describe("list_countries shows the new capabilities", () => {
  it("flags per country and the types, instruments, regions and options for one country", async () => {
    const { api } = client();
    const all = await listCountries(api, {});
    const au = sc(all).countries.find((c: { code: string }) => c.code === "australia");
    expect(au).toMatchObject({ supplementalWithholding: true, equityTax: true });
    expect(sc(all).countries.find((c: { code: string }) => c.code === "germany")).toMatchObject({ supplementalWithholding: true, equityTax: false });
    expect(text(all)).toContain("supplemental (bonus) withholding for 12, equity tax (RSUs, stock options) for 5");
    const uk = await listCountries(api, { country: "uk" });
    expect(sc(uk).details.equityTax).toMatchObject({ values: ["rsu", "emi", "csop", "unapproved_option"], regionRequired: false });
    expect(sc(uk).details.supplementalWithholding.values).toEqual(["bonus", "commission", "rsu_vest", "option_exercise", "lump_sum"]);
    expect(text(uk)).toContain("Equity tax (calculate_equity_tax):");
    expect(text(uk)).toContain("emi (Enterprise Management Incentives (EMI) options)");
    expect(text(uk)).toContain("readily_convertible");
    const de = await listCountries(api, { country: "de" });
    expect(text(de)).toContain("Equity tax (calculate_equity_tax): not available for Germany yet.");
  });
});

describe("golden: pass-through of the captured API 1.8 responses", () => {
  it("US $1M rule: flat 22% on the first $1,000,000 of supplemental wages, mandatory 37% above (Pub 15 s.7)", async () => {
    const { api } = client();
    const r = await supplementalWithholding(api, { country: "us", region: "ca", gross_salary: 500000, amount: 1500000 });
    expect(r.isError, text(r)).toBeFalsy();
    const s = sc(r);
    conforms(SUPP, s);
    const federal = s.lines.find((l: { label: string }) => /^Federal/.test(l.label));
    expect(federal.withheld).toBe(1_000_000 * 0.22 + 500_000 * 0.37);
    expect(s.method).toMatch(/mandatory 37%/);
    expect(s).toMatchObject({ taxYear: "2026", currency: "USD", region: "ca", type: "bonus", amount: 1500000, grossSalary: 500000, totalWithheld: 613200, netPayment: 886800 });
    const raw = load("supplemental-us-1m.json");
    expect(s.lines).toEqual(raw.lines);
    expect(s.totalLiability).toBe(raw.summary.totalLiability);
    expect(s.difference).toBe(raw.summary.difference);
    // Credit footer: tax year, official sources, calcbloc.com page, "Data by CalcBloc", estimate disclaimer.
    const t = text(r);
    expect(t).toContain("tax year 2026");
    expect(t).toContain("Official sources:");
    expect(t).toContain("https://www.irs.gov/pub/irs-pdf/p15.pdf");
    expect(t).toContain("Data by CalcBloc: https://calcbloc.com/us/bonus-tax-calculator?utm_source=calcbloc-mcp");
    expect(t).toContain("Estimate for information only");
    expect(s.sources.map((x: { url: string }) => x.url)).toEqual(raw.sources.map((x: { url: string }) => x.url));
    expect(s.calcblocUrl).toContain("https://calcbloc.com/us/bonus-tax-calculator");
  });

  it("US $10,000 bonus on $150,000 single: $2,200 withheld at 22% vs $2,400 owed at the 24% bracket; California 10.23%", async () => {
    const { api } = client();
    const r = await supplementalWithholding(api, { country: "us", region: "ca", gross_salary: 150000, amount: 10000, type: "bonus", options: { filing_status: "single" } });
    const s = sc(r);
    const line = (re: RegExp) => s.lines.find((l: { label: string }) => re.test(l.label));
    expect(line(/^Federal/)).toMatchObject({ withheld: 2200, liability: 2400 });
    expect(line(/^California income tax/).withheld).toBe(1023);
    expect(line(/SDI/).withheld).toBe(130);
    expect(s.difference).toBe(107);
    expect(text(r)).toContain("USD 107.00 more than is withheld, settled after the year");
  });

  it("UK and Germany: method, lines and totals unchanged; non-US results credit the tax-table page", async () => {
    const { api } = client();
    const uk = await supplementalWithholding(api, { country: "gb", gross_salary: 50000, amount: 10000 });
    const raw = load("supplemental-uk.json");
    expect(sc(uk)).toMatchObject({ taxYear: "2026-27", currency: "GBP", region: "england", method: raw.method, totalWithheld: raw.summary.totalWithheld, totalLiability: raw.summary.totalLiability });
    expect(sc(uk).lines).toEqual(raw.lines);
    expect(sc(uk).calcblocUrl).toContain("https://calcbloc.com/uk/tax-tables/");
    expect(text(uk)).toContain("Supplemental withholding in United Kingdom (England & Northern Ireland), tax year 2026-27");
    const de = await supplementalWithholding(api, { country: "Germany", gross_salary: 60000, amount: 10000, options: { tax_class: 1 } });
    const rawDe = load("supplemental-de.json");
    expect(sc(de)).toMatchObject({ taxYear: "2026", currency: "EUR", method: rawDe.method, totalWithheld: 4978.13, netPayment: 5021.87 });
    conforms(SUPP, sc(de));
    conforms(SUPP, sc(uk));
  });

  it("UK EMI, ETASSUM57030 Example 1: MV at grant £5, price £3, MV at exercise £12, 1,000 shares → £2,000 charged", async () => {
    const { api } = client();
    const r = await equityTax(api, { ...ukEmi });
    expect(r.isError, text(r)).toBeFalsy();
    const s = sc(r);
    conforms(EQUITY, s);
    expect(s).toMatchObject({ taxYear: "2026-27", currency: "GBP", instrument: "emi", units: 1000, taxableAtEvent: 2000, totalTaxAtEvent: 400, totalTaxAtSale: null });
    expect(s.instrumentName).toBe("Enterprise Management Incentives (EMI) options");
    expect(s.flags).toContain("Scheme conditions assumed met");
    const raw = load("equity-uk-emi.json");
    expect(s.lines).toEqual(raw.result.lines);
    const t = text(r);
    expect(t).toContain("taxable at exercise: GBP 2,000.00");
    expect(t).toContain("Total tax at sale: n/a (no sale given)");
    expect(t).toContain("etassum57030");
    expect(t).toContain("Data by CalcBloc: https://calcbloc.com/startup/stock-option-tax-calculator");
    expect(t).toContain("Estimate for information only");
  });

  it("US RSU vest: the vest value is wages, federal withheld at 22%, FICA and California withholding", async () => {
    const { api } = client();
    const r = await equityTax(api, { country: "us", region: "California", instrument: "rsu", units: 100, grant_date: "2025-01-01", event_date: "2026-03-01", fmv_event: 100, gross_salary: 100000 });
    const s = sc(r);
    expect(s).toMatchObject({ taxYear: "2026", region: "ca", taxableAtEvent: 10000, totalTaxAtEvent: 3988 });
    expect(s.lines.find((l: { label: string }) => l.label === "Federal income tax")).toMatchObject({ withheld: 2200, rate: 0.22 });
    expect(text(r)).toContain("At vest (2026-03-01):");
  });

  it("US ISO, Pub 525 Example 8: disqualifying disposition → $200 ordinary income and a $300 long-term gain, with both scenarios", async () => {
    const { api } = client();
    const r = await equityTax(api, { country: "us", instrument: "iso", units: 100, grant_date: "2023-03-12", event_date: "2024-01-07", exercise_price: 10, fmv_event: 12, sale_price: 15, sale_date: "2025-01-27", gross_salary: 100000 });
    const s = sc(r);
    conforms(EQUITY, s);
    const line = (re: RegExp) => s.lines.find((l: { label: string }) => re.test(l.label));
    expect(line(/ordinary income \(disqualifying/).base).toBe(200);
    expect(line(/long-term capital gains/).base).toBe(300);
    expect(s.scenarios.map((x: { name: string }) => x.name)).toEqual(["qualifying", "disqualifying"]);
    expect(s.totalTaxAtSale).toBe(load("equity-us-iso.json").result.totalTaxAtSale);
    expect(text(r)).toContain("At sale (2025-01-27):");
    expect(text(r)).toContain("Scenarios:");
  });
});
