import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as z from "zod/v4";
import { CalcBlocClient, type CountryInfo } from "../src/api.js";
import { DISCLAIMER, NOT_SUPPORTED, NOT_YET_SUPPORTED } from "../src/constants.js";
import { COVERAGE } from "../src/coverage.generated.js";
import { crossBorderEquity, importDuty, registerTools, searchFacts, tariff, taxCalendar, tradeAgreements } from "../src/tools.js";
import { mockFetch, type MockReply } from "./mock-api.js";

/**
 * 0.4.0: the API 1.9 tools (calculate_cross_border_equity, calculate_import_duty, get_tariff, list_trade_agreements,
 * get_tax_calendar) and search_tax_facts (/facts, API 1.8). The fixtures are captured from the site repo's local main
 * (handleApiRequest with an in-memory store and the calcbloc-data tariff shards), since 1.9.0 is not live yet. No test
 * reaches the network.
 */
const client = (override?: (url: URL) => MockReply | undefined) => {
  const m = mockFetch(override);
  return { api: new CalcBlocClient({ apiUrl: "https://calcbloc.test/api/v1", fetch: m.fetch }), calls: m.calls };
};
const text = (r: { content: { text: string }[] }) => r.content.map((c) => c.text).join("\n");
const load = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const fixture = load("countries.json") as { countries: CountryInfo[]; coverage: Record<string, unknown> };
const sc = (r: { structuredContent?: Record<string, unknown> }) => r.structuredContent as Record<string, any>;
const size = (v: unknown) => JSON.stringify(v).length;

type Tool = { name: string; description: string; inputSchema: z.ZodType; outputSchema: z.ZodType; annotations?: Record<string, unknown> };
function tools(): Tool[] {
  const out: Tool[] = [];
  const fake = { registerTool: (name: string, def: Omit<Tool, "name">) => out.push({ name, ...def }) };
  registerTools(fake as never, client().api);
  return out;
}
const tool = (name: string) => tools().find((t) => t.name === name)!;
type JsonSchema = { properties: Record<string, { enum?: string[]; description?: string; pattern?: string; type?: string }>; required?: string[] };
const schema = (name: string) => z.toJSONSchema(tool(name).inputSchema) as JsonSchema;

/** Keys of the structured content that the output schema does not declare (MCP clients reject them). */
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
  const parsed = t.outputSchema.safeParse(value);
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
  expect(undeclared(z.toJSONSchema(t.outputSchema) as Js, value)).toEqual([]);
};

const DUTY = "calculate_import_duty";
const TARIFF = "get_tariff";
const AGREEMENTS = "list_trade_agreements";
const CALENDAR = "get_tax_calendar";
const FACTS = "search_tax_facts";
const XB = "calculate_cross_border_equity";

const usUkRsu = {
  instrument: "rsu",
  units: 1000,
  grant_date: "2024-01-01",
  event_date: "2025-06-30",
  fmv_event: 50,
  currency: "USD",
  periods: [
    { country: "us", start: "2024-01-01", end: "2024-12-31", workdays: 220 },
    { country: "United Kingdom", start: "2025-01-01", end: "2025-06-30", workdays: 120 },
  ],
  salaries: { us: 150000, gb: 80000 },
  options: { usa: { filing_status: "Single" } },
};

describe("schema: the 0.4.0 tools (API 1.9)", () => {
  it("registers fourteen read-only tools in order (get_tax_treaties added in 0.5.0)", () => {
    const all = tools();
    expect(all.map((t) => t.name)).toEqual([
      "calculate_take_home_pay",
      "calculate_employer_cost",
      "compare_countries",
      "calculate_supplemental_withholding",
      "calculate_equity_tax",
      XB,
      DUTY,
      TARIFF,
      AGREEMENTS,
      "get_tax_tables",
      FACTS,
      CALENDAR,
      "get_tax_treaties",
      "list_countries",
    ]);
    for (const t of all) expect(t.annotations?.readOnlyHint).toBe(true);
  });

  it("coverage: cross-border countries and tax calendars come from the /countries capture", () => {
    expect(COVERAGE.crossBorderCountries).toEqual(fixture.coverage.cross_border_countries);
    expect(COVERAGE.crossBorder).toBe(fixture.coverage.cross_border);
    expect(COVERAGE.taxCalendar).toBe(fixture.countries.filter((c) => c.tax_calendar).length);
    expect(COVERAGE.taxTables).toBe(fixture.countries.length);
    expect(NOT_SUPPORTED).toContain(`calculate_cross_border_equity (tax estimates for ${COVERAGE.crossBorderCountries.join(", ")})`);
    expect(NOT_YET_SUPPORTED).toBe(
      "Not yet supported: cross-border salary withholding (multi-country payroll), and the double-tax relief amount (get_tax_treaties lists the treaty withholding limits CalcBloc stores).",
    );
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const block = readme.slice(readme.indexOf("<!-- coverage:start -->"), readme.indexOf("<!-- coverage:end -->"));
    for (const n of [XB, DUTY, TARIFF, AGREEMENTS, FACTS, CALENDAR]) expect(block).toContain(`\`${n}\``);
  });

  it("calculate_import_duty: required inputs, transport enum, destinations and the not-a-ruling caveat", () => {
    const s = schema(DUTY);
    expect(s.required).toEqual(["origin", "hs_code", "customs_value"]);
    expect(s.properties.transport?.enum).toEqual(["vessel", "air", "truck", "rail", "mail", "other"]);
    expect(s.properties.destination?.description).toContain("gb (the UK)");
    expect(s.properties.importer?.description).toContain("Alias of destination");
    const d = tool(DUTY).description;
    expect(d).toContain("TARIC is not legally binding");
    expect(d).toContain("not a customs ruling");
    expect(d).toContain("totals.complete");
  });

  it("get_tariff, list_trade_agreements, search_tax_facts and get_tax_calendar inputs", () => {
    expect(schema(TARIFF).required).toEqual(["hs_code"]);
    expect(schema(TARIFF).properties.cursor).toBeDefined();
    expect(schema(AGREEMENTS).required ?? []).toEqual([]);
    expect(schema(FACTS).properties.level?.enum).toEqual(["national", "state", "county", "municipal", "special_district"]);
    expect(schema(FACTS).required ?? []).toEqual([]);
    expect(schema(CALENDAR).required ?? []).toEqual([]);
    expect(tool(CALENDAR).description).toContain(`${COVERAGE.taxCalendar} countries`);
  });

  it("calculate_cross_border_equity: instrument enum, structured periods, generated countries, no typed-in counts", () => {
    const s = schema(XB);
    expect(s.required).toEqual(["instrument", "units", "grant_date", "event_date", "fmv_event", "periods"]);
    expect(s.properties.instrument?.enum).toEqual(["rsu", "stock_option"]);
    expect(s.properties.periods?.type).toBe("array");
    const d = tool(XB).description;
    expect(d).toContain(`Tax estimates for: ${COVERAGE.crossBorderCountries.join(", ")}`);
    expect(d).toContain(NOT_YET_SUPPORTED);
    expect(d).not.toMatch(/\b\d+ countries\b/);
  });
});

describe("behaviour: import duty", () => {
  it("needs a destination (or importer) and checks codes before any request", async () => {
    const { api, calls } = client();
    for (const [args, msg] of [
      [{ origin: "in", hs_code: "0901210000", customs_value: 100 }, "destination (the importing country) is required"],
      [{ destination: "gb", importer: "de", origin: "in", hs_code: "0901210000", customs_value: 100 }, "name different importing countries"],
      [{ destination: "gb", origin: "in", hs_code: "09x1", customs_value: 100 }, "hs_code must be 4 to 10 digits"],
      [{ destination: "gb", origin: "in", hs_code: "0901210000", customs_value: 100, quantity: 5 }, "quantity and unit go together"],
      [{ destination: "gb", origin: "in", hs_code: "0901210000", customs_value: 100, additional_code: "8A9" }, "not a 4-character code"],
    ] as const) {
      const r = await importDuty(api, args as never);
      expect(r.isError).toBe(true);
      expect(text(r)).toContain(msg);
    }
    expect(calls.filter((c) => c.path === "/import-duty")).toHaveLength(0);
  });

  it("sends the API's parameter names: importer alias, dotted code, code lists upper-cased", async () => {
    const { api, calls } = client();
    await importDuty(api, { importer: "de", origin: "cn", hs_code: "7318.15.42.10", customs_value: 5000, additional_code: ["89xf"], documents: "d008" });
    expect(calls.find((c) => c.path === "/import-duty")!.query).toEqual({ destination: "de", origin: "cn", code: "7318154210", customs_value: "5000", additional_code: "89XF", documents: "D008" });
  });

  it("passes API errors through: ambiguous code, unsupported destination, tariff data unavailable, key required", async () => {
    const { api } = client();
    const amb = await importDuty(api, { destination: "gb", origin: "in", hs_code: "0901", customs_value: 1000 });
    expect(text(amb)).toContain("CalcBloc API error [invalid_parameter]: Code 0901 matches 6 tariff lines");
    const jp = await importDuty(api, { destination: "jp", origin: "in", hs_code: "0901210000", customs_value: 1000 });
    expect(text(jp)).toContain("[unsupported_country]");
    expect(text(jp)).toContain("eu (the European Union)");
    const india = await importDuty(api, { destination: "in", origin: "cn", hs_code: "0901210000", customs_value: 1000 });
    expect(india.isError).toBe(true);
    expect(text(india)).toContain("[service_unavailable]: Tariff data is not available on this server right now");
    const { api: keyless } = client((u) => (u.pathname.endsWith("/import-duty") ? { status: 401, body: load("import-duty-key-required.json") } : undefined));
    const k = await importDuty(keyless, { destination: "gb", origin: "in", hs_code: "0901210000", customs_value: 1000 });
    expect(text(k)).toContain("[api_key_required]");
    expect(text(k)).toContain("CALCBLOC_API_KEY");
  });
});

describe("golden: import duty (API 1.9 captures)", () => {
  it("UK: roasted coffee from India with proof of origin, India-UK CETA free, VAT zero rate, complete", async () => {
    const { api } = client();
    const r = await importDuty(api, { destination: "gb", origin: "in", hs_code: "0901210000", customs_value: 10000, proof_of_origin: true });
    expect(r.isError, text(r)).toBeFalsy();
    const s = sc(r);
    conforms(DUTY, s);
    expect(s).toMatchObject({ destination: "gb", currency: "GBP", customsValue: 10000, mfn: { duty: "6%", amount: 600 }, totals: { customsDuty: 0, importVat: 0, dutiesAndTaxes: 0, landedCost: 10000, complete: true } });
    expect(s.preferential.agreement).toBe("gb-in-ceta");
    expect(s.lines.map((l: { kind: string }) => l.kind)).toEqual(["customs_duty", "import_vat"]);
    expect(s.caveat).toContain("HMRC makes the final determination");
    expect(s.licence).toContain("Open Government Licence");
    const t = text(r);
    expect(t).toContain("Import duty: 0901210000 Not decaffeinated, from India into the United Kingdom");
    expect(t).toContain("Complete: every duty and tax that applies was computed.");
    expect(t).toContain("An estimate from the UK Trade Tariff as of the version date, not a customs ruling.");
    expect(t).toContain(DISCLAIMER);
    expect(t).toContain("Data by CalcBloc: https://calcbloc.com/trade/uk-import-duty-calculator?utm_source=calcbloc-mcp");
    expect(s.sources.map((x: { url: string }) => x.url)).toContain("https://www.trade-tariff.service.gov.uk/commodities/0901210000");
  });

  it("Germany: screws from China, MFN 3.7% and 19% VAT; 103 exporter-specific anti-dumping duties summarised, incomplete", async () => {
    const { api } = client();
    const r = await importDuty(api, { destination: "de", origin: "cn", hs_code: "7318154210", customs_value: 5000 });
    const s = sc(r);
    conforms(DUTY, s);
    const raw = load("import-duty-de-screws-cn.json");
    expect(s).toMatchObject({ memberState: { code: "de", name: "Germany" }, currency: "EUR", totals: { customsDuty: 185, importVat: 985.15, dutiesAndTaxes: 1170.15, complete: false } });
    expect(s.totals.incompleteReasons[0]).toContain("pass the exporter's additional_code");
    expect(s.extraDutiesPossible.reduce((n: number, g: { count: number }) => n + g.count, 0)).toBe(raw.extra_duties_possible.length);
    expect(s.extraDutiesPossible.length).toBeLessThanOrEqual(5);
    for (const g of s.extraDutiesPossible) expect(g.additionalCodes.length).toBeLessThanOrEqual(10);
    expect(s.otherCharges).toHaveLength(2);
    // The raw response is ~150 KB; the tool answer stays small.
    expect(size(s)).toBeLessThan(size(raw) / 5);
    expect(text(r).length).toBeLessThan(30_000);
    expect(text(r)).toContain("TARIC is not legally binding");
    expect(text(r)).toContain("Germany (EU)");
  });

  it("EU without a member state: no import VAT, the reason says to pass one", async () => {
    const { api } = client();
    const s = sc(await importDuty(api, { destination: "eu", origin: "us", hs_code: "8471300000", customs_value: 1000 }));
    conforms(DUTY, s);
    expect(s.memberState).toBeNull();
    expect(s.totals.complete).toBe(false);
    expect(s.totals.incompleteReasons.join(" ")).toContain("pass the member state of import");
  });

  it("United States: Section 301 duty on Chinese furniture, entry fees by vessel, CBP caveat", async () => {
    const { api, calls } = client();
    const r = await importDuty(api, { destination: "us", origin: "cn", hs_code: "9403200050", customs_value: 5000, transport: "vessel" });
    const s = sc(r);
    conforms(DUTY, s);
    expect(calls.find((c) => c.path === "/import-duty")!.query.transport).toBe("vessel");
    expect(s.totals).toMatchObject({ extraDuties: 1250, fees: 40.83, dutiesAndTaxes: 1290.83, landedCost: 6290.83, complete: false });
    expect(s.lines.filter((l: { kind: string }) => l.kind === "fee")).toHaveLength(2);
    expect(s.caveat).toContain("U.S. Customs and Border Protection makes the final determination");
  });

  it("UK beer without excise_code: excise not computed, totals incomplete", async () => {
    const { api } = client();
    const s = sc(await importDuty(api, { destination: "gb", origin: "de", hs_code: "2203000100", customs_value: 1000 }));
    expect(s.totals).toMatchObject({ importVat: 200, complete: false });
    expect(s.totals.incompleteReasons[0]).toContain("pass excise_code");
  });
});

describe("behaviour and golden: get_tariff", () => {
  it("without origin: lines with preferences grouped by duty, the cursor and a hint to pass origin", async () => {
    const { api, calls } = client();
    const r = await tariff(api, { destination: "gb", hs_code: "09.01" });
    expect(r.isError, text(r)).toBeFalsy();
    expect(calls.find((c) => c.path === "/tariffs")!.query).toEqual({ destination: "gb", code: "0901", limit: "10" });
    const s = sc(r);
    conforms(TARIFF, s);
    const raw = load("tariffs-gb-0901.json");
    expect(s).toMatchObject({ code: "0901", total: 6, count: 3, nextCursor: raw.next_cursor });
    const first = s.lines[0];
    expect(first.preferential).toEqual([]);
    expect(first.preferentialCount).toBe(raw.lines[0].preferential.length);
    expect(first.preferentialByDuty.flatMap((g: { agreements: string[] }) => g.agreements)).toContain("eu-gb-tca");
    expect(size(s)).toBeLessThan(size(raw) / 4);
    const t = text(r);
    expect(t).toContain(`cursor "${raw.next_cursor}"`);
    expect(t).toContain("Pass origin");
    expect(t).toContain("HMRC makes the final determination");
  });

  it("with origin: the best preference and only that origin's preferences", async () => {
    const { api } = client();
    const s = sc(await tariff(api, { destination: "gb", hs_code: "0901", origin: "in" }));
    conforms(TARIFF, s);
    expect(s.origin).toEqual({ iso: "IN", name: "India" });
    const roasted = s.lines.find((l: { code: string }) => l.code === "0901210000");
    expect(roasted.bestPreferential).toMatchObject({ agreement: "gb-in-ceta", duty: "Free" });
    expect(roasted.preferential.map((p: { agreement: string }) => p.agreement).sort()).toEqual(["gb-dcts-standard", "gb-in-ceta"]);
    expect(roasted.preferentialByDuty).toEqual([]);
  });

  it("US furniture from China: the Section 301 extra duty", async () => {
    const { api } = client();
    const s = sc(await tariff(api, { destination: "us", hs_code: "940320", origin: "cn" }));
    conforms(TARIFF, s);
    expect(s.lines.every((l: { extraDuties: { duty: string }[] }) => l.extraDuties.some((g) => g.duty === "25%"))).toBe(true);
  });

  it("an unknown code is the API's not_found error", async () => {
    const { api } = client();
    const r = await tariff(api, { destination: "gb", hs_code: "0000" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("[not_found]: No commodity code starting 0000");
  });
});

describe("behaviour and golden: list_trade_agreements", () => {
  it("US programs: a compact list; one agreement by id adds the rules of origin", async () => {
    const { api, calls } = client();
    const r = await tradeAgreements(api, { destination: "us" });
    const s = sc(r);
    conforms(AGREEMENTS, s);
    expect(calls.find((c) => c.path === "/trade-agreements")!.query).toEqual({ country: "us" });
    expect(s.count).toBe(load("trade-agreements-us.json").count);
    expect(s.agreements[0].rulesOfOrigin).toBeUndefined();
    expect(text(r)).toContain("Call again with partner");
    const one = sc(await tradeAgreements(api, { importer: "us", agreement: "us-gsp" }));
    conforms(AGREEMENTS, one);
    expect(one.agreements).toHaveLength(1);
    expect(one.agreements[0].rulesOfOrigin).toContain("General Note 4");
  });

  it("UK agreements covering India, with rules of origin and gov.uk sources; an unknown id lists the ids", async () => {
    const { api } = client();
    const r = await tradeAgreements(api, { destination: "gb", partner: "in" });
    const s = sc(r);
    conforms(AGREEMENTS, s);
    expect(s.agreements.map((a: { id: string }) => a.id)).toEqual(["gb-dcts-standard", "gb-in-ceta"]);
    expect(s.agreements[1].rulesOfOrigin).toContain("Origin Reference Document");
    expect(s.sources.some((x: { url: string }) => x.url.startsWith("https://www.gov.uk/"))).toBe(true);
    const bad = await tradeAgreements(api, { destination: "us", agreement: "nafta-1994" });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain("us-gsp");
  });
});

describe("behaviour and golden: get_tax_calendar", () => {
  it("UK: tax year 2026-27 with 130 days left on 2026-11-26, 13 changes with official sources, next budget not announced", async () => {
    const { api, calls } = client();
    const r = await taxCalendar(api, { country: "United Kingdom" });
    expect(r.isError, text(r)).toBeFalsy();
    expect(calls.find((c) => c.path === "/tax-calendar")!.query).toEqual({ country: "uk" });
    const s = sc(r);
    conforms(CALENDAR, s);
    expect(s.countries).toBeNull();
    expect(s.calendar).toMatchObject({ country: "uk", taxYear: { label: "2026-27", displayLabel: "2026/27", start: "2026-04-06", daysRemaining: 130, type: "fiscal" }, nextTaxYear: { start: "2027-04-06" }, nextBudget: { status: "not_announced" } });
    expect(s.calendar.upcomingChanges).toHaveLength(13);
    expect(s.calendar.upcomingChanges[0]).toMatchObject({ id: "uk-bank-surcharge-2027", status: "announced" });
    expect(s.sources.map((x: { url: string }) => x.url)).toContain("https://www.gov.uk/government/publications/budget-2026-document/budget-2026-html");
    const t = text(r);
    expect(t).toContain("Next budget: not announced; last: Budget 2026 (2026-10-28)");
    expect(t).toContain("Data by CalcBloc: https://calcbloc.com/uk/tax-tables/2026-27");
  });

  it("a region by name is sent as its code and its changes are tagged", async () => {
    const { api, calls } = client();
    const s = sc(await taxCalendar(api, { country: "us", region: "California" }));
    expect(calls.find((c) => c.path === "/tax-calendar")!.query).toEqual({ country: "us", region: "ca" });
    expect(s.calendar.region).toEqual({ code: "ca", name: "California" });
    expect(s.calendar.upcomingChanges.filter((c: { region: unknown }) => c.region)).toHaveLength(2);
  });

  it("without country: one line per country from /countries (no extra request); region alone and unknown countries are refused", async () => {
    const { api, calls } = client();
    const r = await taxCalendar(api, {});
    const s = sc(r);
    conforms(CALENDAR, s);
    expect(calls.filter((c) => c.path === "/tax-calendar")).toHaveLength(0);
    expect(s.countries).toHaveLength(COVERAGE.taxCalendar);
    // The /countries capture is from API 1.10 on 2026-11-27 (0.5.0).
    expect(s.asOf).toBe("2026-11-27");
    expect(s.countries.find((c: { shortCode: string }) => c.shortCode === "us")).toMatchObject({ taxYear: "2026", daysRemaining: 34, nextTaxYearStart: "2027-01-01" });
    expect((await taxCalendar(api, { region: "ca" })).isError).toBe(true);
    const bad = await taxCalendar(api, { country: "Narnia" });
    expect(text(bad)).toContain('CalcBloc does not cover "Narnia"');
    expect(calls.filter((c) => c.path === "/tax-calendar")).toHaveLength(0);
  });
});

describe("behaviour and golden: search_tax_facts", () => {
  it("UK income tax bands as facts, with the country resolved locally", async () => {
    const { api, calls } = client();
    const r = await searchFacts(api, { country: "gb", tax_type: "income.pit" });
    const s = sc(r);
    conforms(FACTS, s);
    expect(calls.find((c) => c.path === "/facts")!.query).toEqual({ country: "uk", tax_type: "income.pit", limit: "25" });
    expect(s).toMatchObject({ total: 6, count: 6, nextCursor: null });
    expect(s.facts[0]).toMatchObject({ taxType: "income.pit", jurisdiction: "gb", measure: "bands", bands: [{ label: "Basic rate", from: 0, to: 37700, rate: 0.2 }, { from: 37700 }, { from: 125140, to: null, rate: 0.45 }] });
    expect(text(r)).toContain("Basic rate 0 to 37,700 at 20%");
  });

  it("California sales and use tax facts by jurisdiction; an unknown tax type is the API's error", async () => {
    const { api } = client();
    const s = sc(await searchFacts(api, { jurisdiction: "US-CA", tax_type: "consumption." }));
    conforms(FACTS, s);
    expect(s.facts.find((f: { id: string }) => f.id === "us-ca.consumption.sales.state.rate.2026")).toMatchObject({ value: 0.0725, level: "state" });
    const bad = await searchFacts(api, { tax_type: "nonsense" });
    expect(text(bad)).toContain("[invalid_parameter]: Unknown tax_type");
  });
});

describe("behaviour: cross-border equity", () => {
  it("encodes periods, salaries and options in the API's compact form, with names and aliases resolved", async () => {
    const { api, calls } = client();
    const r = await crossBorderEquity(api, usUkRsu);
    expect(r.isError, text(r)).toBeFalsy();
    expect(calls.find((c) => c.path === "/cross-border-equity")!.query).toEqual({
      instrument: "rsu",
      units: "1000",
      grant_date: "2024-01-01",
      event_date: "2025-06-30",
      fmv_event: "50",
      currency: "USD",
      periods: "us:2024-01-01:2024-12-31:220,uk:2025-01-01:2025-06-30:120",
      salaries: "us:150000,uk:80000",
      options: "us.filing_status:single",
    });
  });

  it("Canada without a province fails before the request and lists the codes; with one, it is sent", async () => {
    const base = { instrument: "stock_option", units: 500, grant_date: "2023-01-01", event_date: "2026-03-02", fmv_event: 40, exercise_price: 10, currency: "CAD", periods: [{ country: "ca", start: "2023-01-01", end: "2024-12-31" }, { country: "us", start: "2025-01-01", end: "2026-03-02" }] };
    const { api, calls } = client();
    const r = await crossBorderEquity(api, base);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('Canada needs a region for its estimate: pass options {"ca": {"region": "on"}}');
    expect(text(r)).toContain("on (Ontario)");
    expect(calls.filter((c) => c.path === "/cross-border-equity")).toHaveLength(0);
    const ok = await crossBorderEquity(api, { ...base, options: { ca: { region: "Ontario" } } });
    expect(ok.isError, text(ok)).toBeFalsy();
    expect(calls.find((c) => c.path === "/cross-border-equity")!.query.options).toBe("canada.region:on");
  });

  it("checks dates, the exercise price and option names before the request", async () => {
    const { api, calls } = client();
    const cases: [Record<string, unknown>, string][] = [
      [{ ...usUkRsu, instrument: "stock_option" }, "exercise_price is required for stock_option"],
      [{ ...usUkRsu, event_date: "2023-12-31" }, "cannot be before grant_date"],
      [{ ...usUkRsu, vest_date: "2026-01-01" }, "vest_date (2026-01-01) must lie between"],
      [{ ...usUkRsu, periods: [{ country: "us", start: "2024-12-31", end: "2024-01-01" }] }, "end (2024-01-01) is before start"],
      [{ ...usUkRsu, options: { us: { filing: "single" } } }, '"filing" is not an option for United States (equity tax)'],
      [{ ...usUkRsu, periods: [{ country: "Atlantis", start: "2024-01-01", end: "2024-12-31" }] }, 'CalcBloc does not cover "Atlantis"'],
    ];
    for (const [args, msg] of cases) {
      const r = await crossBorderEquity(api, args as never);
      expect(r.isError, msg).toBe(true);
      expect(text(r)).toContain(msg);
    }
    expect(calls.filter((c) => c.path === "/cross-border-equity")).toHaveLength(0);
  });
});

describe("golden: cross-border equity (API 1.9 captures)", () => {
  it("US then UK RSUs: 220 of 340 workdays sourced to the US (Treas. Reg. § 1.861-4), UK share by HMRC's relevant period, relief flagged", async () => {
    const { api } = client();
    const r = await crossBorderEquity(api, usUkRsu);
    const s = sc(r);
    conforms(XB, s);
    expect(s).toMatchObject({ estimate: true, instrument: "rsu", totalIncome: 50000, totalWorkdays: 340, residence: { country: "uk" } });
    const us = s.countries.find((c: { country: string }) => c.country === "us");
    expect(us).toMatchObject({ countryName: "United States", workdays: 220, taxableAmount: 32352.94, estimate: { estimatedTax: 10239.71, withheld: 9592.65 } });
    expect(s.countries.find((c: { country: string }) => c.country === "uk")).toMatchObject({ taxableAmount: 17647.06, isResidence: true });
    expect(s.relief[0]).toMatchObject({ source: "us", other: "uk", kind: "residence_relief", treaty: "listed" });
    expect(s.sources.map((x: { url: string }) => x.url)).toContain("https://www.ecfr.gov/current/title-26/section-1.861-4");
    const t = text(r);
    expect(t).toContain("Cross-border equity (estimate): RSUs, 1,000 units, income USD 50,000.00");
    expect(t).toContain("Double taxation (relief not computed):");
    expect(t).toContain(DISCLAIMER);
    expect(t).toContain("Data by CalcBloc");
  });

  it("Canada then US options: workdays counted Monday to Friday, the US taxes the whole spread as residence", async () => {
    const { api } = client();
    const r = await crossBorderEquity(api, {
      instrument: "stock_option",
      units: 500,
      grant_date: "2023-01-01",
      event_date: "2026-03-02",
      fmv_event: 40,
      exercise_price: 10,
      currency: "CAD",
      periods: [
        { country: "canada", start: "2023-01-01", end: "2024-12-31" },
        { country: "us", start: "2025-01-01", end: "2026-03-02" },
      ],
      salaries: { ca: 120000, us: 160000 },
      options: { ca: { region: "on" } },
    });
    const s = sc(r);
    conforms(XB, s);
    expect(s.flags).toContain("workdays_computed");
    expect(s.periods.every((p: { computed: boolean }) => p.computed)).toBe(true);
    expect(s.countries.find((c: { country: string }) => c.country === "us")).toMatchObject({ basis: "residence_worldwide", taxableShare: 1 });
    expect(text(r)).toContain("(Monday to Friday, counted)");
  });
});
