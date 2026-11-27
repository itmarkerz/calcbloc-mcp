import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as z from "zod/v4";
import { CalcBlocClient, type CountryInfo } from "../src/api.js";
import { DISCLAIMER, NOT_YET_SUPPORTED, SERVER_INSTRUCTIONS } from "../src/constants.js";
import { COVERAGE } from "../src/coverage.generated.js";
import { employerCost, listCountries, registerTools, takeHomePay, taxTreaties, TREATY_CAVEAT, verificationOf } from "../src/tools.js";
import { mockFetch, type MockReply } from "./mock-api.js";

/**
 * 0.5.0: API 1.10. get_tax_treaties (/tax-treaties), the verification marker of the shared take-home engine on
 * calculate_take_home_pay and calculate_employer_cost, and Denmark, Estonia and Poland with their own options. The
 * fixtures are captured from the site repo's local main 94129042 (handleApiRequest with an in-memory store and key),
 * since 1.10.0 is not live yet; the Danish, Estonian and Polish tax-table captures keep the payroll sections only (the
 * groups the calculation tools take their sources from). No test reaches the network.
 */
const client = (override?: (url: URL) => MockReply | undefined) => {
  const m = mockFetch(override);
  return { api: new CalcBlocClient({ apiUrl: "https://calcbloc.test/api/v1", fetch: m.fetch }), calls: m.calls };
};
const text = (r: { content: { text: string }[] }) => r.content.map((c) => c.text).join("\n");
const load = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const fixture = load("countries.json") as { countries: CountryInfo[]; coverage: Record<string, unknown> };
const sc = (r: { structuredContent?: Record<string, unknown> }) => r.structuredContent as Record<string, any>;

type Tool = { name: string; description: string; inputSchema: z.ZodType; outputSchema: z.ZodType; annotations?: Record<string, unknown> };
function tools(): Tool[] {
  const out: Tool[] = [];
  const fake = { registerTool: (name: string, def: Omit<Tool, "name">) => out.push({ name, ...def }) };
  registerTools(fake as never, client().api);
  return out;
}
const tool = (name: string) => tools().find((t) => t.name === name)!;
type JsonSchema = { properties: Record<string, { enum?: string[]; description?: string; type?: string }>; required?: string[] };
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

const TREATIES = "get_tax_treaties";
const TAKE_HOME = "calculate_take_home_pay";
const EMPLOYER = "calculate_employer_cost";

describe("schema: the 0.5.0 changes (API 1.10)", () => {
  it("get_tax_treaties: read-only, country required, partner optional, scope and caveats in the description", () => {
    const t = tool(TREATIES);
    expect(t.annotations?.readOnlyHint).toBe(true);
    const s = schema(TREATIES);
    expect(s.required).toEqual(["country"]);
    expect(s.properties.partner).toBeDefined();
    for (const words of ["dividends", "interest, royalties and fees for technical services", "relief", "MLI", "India", "Nothing is computed", "not tax advice"]) expect(t.description).toContain(words);
    expect(SERVER_INSTRUCTIONS).toContain("get_tax_treaties");
  });

  it("coverage: Denmark, Estonia and Poland have take-home pay, employer cost and compare; 217 countries, from the /countries capture", () => {
    expect(COVERAGE.taxTables).toBe(fixture.countries.length);
    expect(COVERAGE.taxTables).toBe(217);
    for (const c of ["dk", "ee", "pl"]) {
      expect(COVERAGE.netSalaryCountries).toContain(c);
      expect(COVERAGE.employerCostCountries).toContain(c);
      expect(COVERAGE.compareCountries).toContain(c);
    }
    expect(COVERAGE.netSalaryCountries).toEqual(fixture.coverage.net_salary_countries);
    expect(tool(TAKE_HOME).description).toContain("ee, pl, dk");
    expect(NOT_YET_SUPPORTED).toContain("get_tax_treaties");
    for (const f of ["../package.json", "../server.json"]) expect(readFileSync(new URL(f, import.meta.url), "utf8")).toContain("217 countries");
  });

  it("the calculation output schemas declare the verification marker", () => {
    for (const name of [TAKE_HOME, EMPLOYER]) {
      const out = z.toJSONSchema(tool(name).outputSchema) as { properties: Record<string, unknown>; required?: string[] };
      expect(out.properties.verification, name).toBeDefined();
      expect(out.required, name).toContain("verification");
    }
  });

  it("version 0.5.0 everywhere it is written", () => {
    const pkg = load("../../package.json");
    const server = load("../../server.json");
    const lock = load("../../package-lock.json");
    expect(pkg.version).toBe("0.5.0");
    expect(server.version).toBe("0.5.0");
    expect(server.packages[0].version).toBe("0.5.0");
    expect(lock.version).toBe("0.5.0");
    expect(lock.packages[""].version).toBe("0.5.0");
    expect(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8")).toContain("## 0.5.0");
  });
});

describe("behaviour and golden: the verification marker", () => {
  it("verificationOf: status, words and the URLs of the first note; null for the country-specific engines", () => {
    const ee = load("net-salary-estonia.json");
    expect(verificationOf(ee)).toEqual({
      status: "official-example",
      label: "checked against an official worked example",
      urls: ["https://emta.ee/node/330/chapter/13288/pdf", "https://emta.ee/node/330/chapter/13291/pdf"],
    });
    const dk = verificationOf(load("net-salary-denmark.json"))!;
    expect(dk.status).toBe("law-text");
    expect(dk.label).toBe("computed from the law text; no official example is published");
    expect(dk.urls).toHaveLength(4);
    expect(dk.urls.every((u) => /^https:\/\/(svmn\.dk|info\.skat\.dk)\//.test(u))).toBe(true);
    expect(verificationOf(load("net-salary-uk.json"))).toBeNull();
    expect(verificationOf({ verification: null, notes: [] })).toBeNull();
  });

  it("Estonia take-home pay (EMTA worked examples): 6% funded pension by label, marker in text and structured content", async () => {
    const { api, calls } = client();
    const r = await takeHomePay(api, { country: "Estonia", gross_salary: 36000, options: { funded_pension: "6%" } });
    expect(r.isError, text(r)).toBeFalsy();
    const s = sc(r);
    conforms(TAKE_HOME, s);
    expect(calls.find((c) => c.path === "/net-salary")!.query).toEqual({ country: "estonia", salary: "36000", year: "2026", funded_pension: "2" });
    expect(s).toMatchObject({ country: "estonia", taxYear: "2026", currency: "EUR", netAnnual: 27793.92, totalDeductions: 8206.08 });
    expect(s.verification).toMatchObject({ status: "official-example", label: "checked against an official worked example" });
    const t = text(r);
    expect(t).toContain("Verification: checked against an official worked example; see https://emta.ee/node/330/chapter/13288/pdf https://emta.ee/node/330/chapter/13291/pdf");
    expect(t).toContain("Data by CalcBloc");
    expect(t).toContain(DISCLAIMER);
    expect(s.sources.length).toBeGreaterThan(0);
    expect(s.sources.every((x: { url: string }) => x.url.startsWith("https://"))).toBe(true);
  });

  it("Denmark take-home pay (law text): municipality by name and church as yes", async () => {
    const { api, calls } = client();
    const r = await takeHomePay(api, { country: "dk", gross_salary: 600000, options: { municipality: "København", church: "yes" } });
    expect(r.isError, text(r)).toBeFalsy();
    const s = sc(r);
    conforms(TAKE_HOME, s);
    expect(calls.find((c) => c.path === "/net-salary")!.query).toMatchObject({ country: "denmark", municipality: "101", church: "true" });
    expect(s).toMatchObject({ currency: "DKK", netAnnual: 387125.04, verification: { status: "law-text" } });
    expect(text(r)).toContain("Verification: computed from the law text; no official example is published; see https://svmn.dk/");
  });

  it("Poland employer cost (biznes.gov.pl worked example) and Denmark employer cost", async () => {
    const { api, calls } = client();
    const pl = await employerCost(api, { country: "Poland", gross_salary: 120000, options: { accident_rate_pct: "1.67%" } });
    expect(pl.isError, text(pl)).toBeFalsy();
    conforms(EMPLOYER, sc(pl));
    expect(calls.find((c) => c.path === "/employer-cost")!.query).toMatchObject({ country: "poland", accident_rate_pct: "1.67" });
    expect(sc(pl)).toMatchObject({ currency: "PLN", totalCost: 144576, monthlyCost: 12048, multiplier: 1.2048, verification: { status: "official-example", urls: ["https://www.biznes.gov.pl/pl/portal/0083"] } });
    expect(text(pl)).toContain("Verification: checked against an official worked example; see https://www.biznes.gov.pl/pl/portal/0083");
    const dk = await employerCost(api, { country: "denmark", gross_salary: 600000 });
    expect(sc(dk)).toMatchObject({ totalCost: 602376, verification: { status: "law-text" } });
  });

  it("an option of another country is refused with this country's options (no request sent)", async () => {
    const { api, calls } = client();
    const r = await takeHomePay(api, { country: "pl", gross_salary: 120000, options: { municipality: "101" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("accident_rate_pct");
    expect(calls.filter((c) => c.path === "/net-salary")).toHaveLength(0);
  });

  it("countries with their own engine: verification null and no marker line", async () => {
    const { api } = client();
    const r = await takeHomePay(api, { country: "uk", gross_salary: 50000, region: "scotland" });
    expect(sc(r).verification).toBeNull();
    conforms(TAKE_HOME, sc(r));
    expect(text(r)).not.toContain("Verification:");
  });

  it("list_countries shows the verification of each calculation", async () => {
    const { api } = client();
    const r = await listCountries(api, { country: "ee" });
    const s = sc(r);
    expect(s.details.takeHomePay.verification).toBe("official-example");
    expect(s.details.employerCost.verification).toBe("official-example");
    expect(text(r)).toContain("- verification: checked against an official worked example");
    expect(text(r)).toContain("funded_pension");
    expect(sc(await listCountries(api, { country: "us" })).details.takeHomePay.verification).toBeNull();
  });
});

describe("behaviour and golden: get_tax_treaties", () => {
  it("India: the six treaties with their limits, relief methods, dates and official copies", async () => {
    const { api, calls } = client();
    const r = await taxTreaties(api, { country: "India" });
    expect(r.isError, text(r)).toBeFalsy();
    const s = sc(r);
    conforms(TREATIES, s);
    expect(calls.find((c) => c.path === "/tax-treaties")!.query).toEqual({ country: "in" });
    expect(s).toMatchObject({ country: "in", countryName: "India", partner: null, partnerName: null, count: 6 });
    expect(s.treaties.map((t: { partner: string }) => t.partner)).toEqual(["us", "sg", "gb", "jp", "au", "at"]);
    const us = s.treaties[0];
    expect(us).toMatchObject({ partnerName: "United States", signed: "1989-09-12", inForce: "1990-12-18", mli: null, reliefMethod: { in: "credit", us: "credit" } });
    expect(us.withholding[0]).toMatchObject({ kind: "dividend_substantial", income: "Dividends (qualifying shareholding)", rate: 0.15, article: "Article 10(2)(a)" });
    expect(us.source).toMatchObject({ url: "https://www.irs.gov/pub/irs-trty/india.pdf", publisher: "Internal Revenue Service (U.S. Department of the Treasury)", retrievedAt: "2026-11-26" });
    expect(s.treaties.find((t: { partner: string }) => t.partner === "jp").withholding.map((w: { rate: number }) => w.rate)).toEqual([0.1, 0.1, 0.1, 0.1]);
    expect(s.sources).toHaveLength(6);
    expect(s.sources.map((x: { url: string }) => new URL(x.url).hostname)).toEqual(["www.irs.gov", "www.iras.gov.sg", "assets.publishing.service.gov.uk", "www.mof.go.jp", "www.ato.gov.au", "www.bmf.gv.at"]);
    const t = text(r);
    expect(t).toContain("Double taxation treaties of India: 6 stored");
    expect(t).toContain("- Dividends (qualifying shareholding): 15% (Article 10(2)(a))");
    expect(t).toContain("Relief from double taxation: India credit; United States credit");
    expect(t).toContain("MLI: modifies this treaty");
    expect(t).not.toContain("Wording:");
    expect(t).toContain("Call get_tax_treaties with partner");
    expect(t).toContain(TREATY_CAVEAT);
    expect(t).toContain(DISCLAIMER);
    expect(t).toContain("Data by CalcBloc");
    expect(t).toContain("Official sources:");
  });

  it("partner: uk, gb or a name all give the India-UK treaty, with each article's wording", async () => {
    for (const partner of ["uk", "gb", "United Kingdom"]) {
      const { api, calls } = client();
      const r = await taxTreaties(api, { country: "in", partner });
      expect(r.isError, text(r)).toBeFalsy();
      expect(calls.find((c) => c.path === "/tax-treaties")!.query, partner).toEqual({ country: "in", partner: "gb" });
      const s = sc(r);
      conforms(TREATIES, s);
      expect(s).toMatchObject({ partner: "gb", partnerName: "United Kingdom", count: 1 });
      expect(s.treaties[0]).toMatchObject({ inForce: "1993-10-25", signed: "1993-01-25" });
      const t = text(r);
      expect(t).toContain("Double taxation treaty: India and United Kingdom");
      expect(t).toContain("Relief from double taxation: India credit; United Kingdom credit");
      expect(t).toContain('Wording: "b) 10 per cent of the gross amount of the dividends, in all other cases."');
      expect(t).toContain("https://assets.publishing.service.gov.uk/");
    }
  });

  it("a partner without a stored treaty, an unknown partner and the same country twice", async () => {
    const { api, calls } = client();
    const fr = await taxTreaties(api, { country: "india", partner: "France" });
    expect(fr.isError).toBeFalsy();
    conforms(TREATIES, sc(fr));
    expect(sc(fr)).toMatchObject({ count: 0, partner: "fr", partnerName: "France", treaties: [] });
    expect(text(fr)).toContain('No treaty between India and France is stored in CalcBloc. Call get_tax_treaties with country "in" alone');
    const before = calls.length;
    const bad = await taxTreaties(api, { country: "in", partner: "Atlantis" });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain('Unknown partner country "Atlantis"');
    expect(text(bad).length).toBeLessThan(300);
    const same = await taxTreaties(api, { country: "in", partner: "India" });
    expect(same.isError).toBe(true);
    expect(calls.slice(before).filter((c) => c.path === "/tax-treaties")).toHaveLength(0);
  });

  it("a country without treaties gets the countries that have them, by name", async () => {
    const { api } = client();
    const r = await taxTreaties(api, { country: "Germany" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("No double taxation treaties are stored for Germany yet. Treaties are stored for: in (India).");
  });

  it("an API older than 1.10 (no /tax-treaties) says so", async () => {
    const { api } = client((url) =>
      url.pathname.endsWith("/tax-treaties") ? { status: 404, body: { error: { code: "not_found", message: "No such endpoint. See the documentation for the list." } } } : undefined,
    );
    const r = await taxTreaties(api, { country: "in" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("need API 1.10 or later");
  });
});
