import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as z from "zod/v4";
import { CalcBlocClient } from "../src/api.js";
import { NOT_SUPPORTED } from "../src/constants.js";
import { COVERAGE } from "../src/coverage.generated.js";
import { compareCountries, employerCost, registerTools, takeHomePay } from "../src/tools.js";
import { mockFetch } from "./mock-api.js";

/**
 * 0.2.0: the fixes for the CorpusIQ review (region requirement in the schema text and errors, consistent codes and
 * option aliases, generated coverage counts, scope note), plus the schema and golden checks CI runs on every PR.
 */
const client = () => {
  const m = mockFetch();
  return { api: new CalcBlocClient({ apiUrl: "https://calcbloc.test/api/v1", fetch: m.fetch }), calls: m.calls };
};
const text = (r: { content: { text: string }[] }) => r.content.map((c) => c.text).join("\n");
const fixture = JSON.parse(readFileSync(new URL("./fixtures/countries.json", import.meta.url), "utf8"));

type Tool = { name: string; description: string; inputSchema: z.ZodType };
function tools(): Tool[] {
  const out: Tool[] = [];
  const fake = { registerTool: (name: string, def: { description: string; inputSchema: z.ZodType }) => out.push({ name, ...def }) };
  registerTools(fake as never, client().api);
  return out;
}
const tool = (name: string) => tools().find((t) => t.name === name)!;
const schema = (name: string) => z.toJSONSchema(tool(name).inputSchema) as { properties: Record<string, { enum?: string[]; description?: string }>; required?: string[] };

describe("schema: tool descriptions and input schemas", () => {
  it("say which countries need region, from the generated coverage", () => {
    expect(COVERAGE.regionRequired["net-salary"]).toContain("us");
    for (const [name, kind] of [["calculate_take_home_pay", "net-salary"], ["calculate_employer_cost", "employer-cost"]] as const) {
      const t = tool(name);
      expect(t.description).toContain(`region is REQUIRED for: ${COVERAGE.regionRequired[kind].join(", ")}`);
      expect(schema(name).properties.region?.description).toContain(`Required for: ${COVERAGE.regionRequired[kind].join(", ")}`);
    }
    expect(schema("compare_countries").properties).toHaveProperty("region_a");
    expect(schema("compare_countries").properties).toHaveProperty("region_b");
  });

  it("use only values the API accepts in examples (no filing_status married) and state the scope", () => {
    for (const t of tools()) {
      const all = JSON.stringify(z.toJSONSchema(t.inputSchema)) + t.description;
      expect(all, t.name).not.toContain('"filing_status":"married"');
      expect(all, t.name).not.toContain('\\"filing_status\\":\\"married\\"');
    }
    const opts = schema("calculate_take_home_pay").properties.options?.description ?? "";
    expect(opts).toContain('"filing_status":"mfj"');
    for (const v of COVERAGE.examples.usFilingStatus) expect(opts).toContain(v);
    for (const n of ["calculate_take_home_pay", "calculate_employer_cost", "compare_countries"]) expect(tool(n).description).toContain(NOT_SUPPORTED);
  });

  it("use enums where the set is fixed", () => {
    expect(schema("get_tax_tables").properties.group?.enum).toEqual(["income-tax", "employee", "employer", "other"]);
    expect(schema("calculate_take_home_pay").required).toEqual(["country", "gross_salary"]);
  });

  it("quote coverage counts generated from /countries (the fixture is a capture of API 1.7)", () => {
    const has = (e: string) => fixture.countries.filter((c: { available_endpoints: string[] }) => c.available_endpoints.includes(e)).length;
    expect(COVERAGE.taxTables).toBe(fixture.countries.length);
    expect(COVERAGE.netSalary).toBe(has("net-salary"));
    expect(COVERAGE.employerCost).toBe(has("employer-cost"));
    expect(COVERAGE.compare).toBe(has("compare"));
    expect(COVERAGE.summary).toBe(fixture.coverage.summary);
    expect(tool("list_countries").description).toContain(COVERAGE.summary);
    // No hard-coded counts anywhere in the descriptions.
    for (const t of tools()) expect(t.description, t.name).not.toMatch(/\b(13|24|37) countries\b/);
  });
});

describe("region requirement and aliases", () => {
  it("a US calculation without region fails before calling the API and lists the codes with names", async () => {
    const { api, calls } = client();
    const r = await takeHomePay(api, { country: "us", gross_salary: 100000 });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("needs a region");
    expect(text(r)).toContain("ca (California)");
    expect(calls.filter((c) => c.path === "/net-salary")).toHaveLength(0);
    const e = await employerCost(api, { country: "us", gross_salary: 100000 });
    expect(e.isError).toBe(true);
    expect(text(e)).toContain("ny (New York)");
  });

  it("accepts region names, country short codes and names, and filing_status aliases, sending canonical values", async () => {
    const cases: [string, string, string][] = [["us", "California", "married"], ["United States", "ca", "Married filing jointly"], ["USA", "CA", "married_joint"]];
    for (const [country, region, fs] of cases) {
      const { api, calls } = client();
      const r = await takeHomePay(api, { country, gross_salary: 100000, region, options: { filing_status: fs } });
      expect(r.isError, text(r)).toBeFalsy();
      const q = calls.find((c) => c.path === "/net-salary")!.query;
      expect(q).toMatchObject({ country: "us", region: "ca", filing_status: "mfj" });
    }
    const { api, calls } = client();
    await takeHomePay(api, { country: "us", gross_salary: 100000, region: "ca", options: { filing_status: "head_of_household" } });
    expect(calls.find((c) => c.path === "/net-salary")!.query.filing_status).toBe("hoh");
  });

  it("resolves nz, gb and full names to the API keys for compare", async () => {
    const { api, calls } = client();
    await compareCountries(api, { country_a: "gb", country_b: "Germany", gross_salary: 60000 });
    expect(calls.find((c) => c.path === "/compare")!.query).toMatchObject({ a: "uk", b: "germany" });
  });
});

describe("golden: $100,000 single, California, 2026 (figures from the API; checked against IRS, SSA, EDD and FTB in the site repo)", () => {
  it("passes every figure through unchanged", async () => {
    const { api } = client();
    const r = await takeHomePay(api, { country: "us", region: "ca", gross_salary: 100000, options: { filing_status: "single" } });
    expect(r.isError, text(r)).toBeFalsy();
    const s = r.structuredContent as Record<string, any>;
    expect(s.taxYear).toBe("2026");
    expect(s.netAnnual).toBeCloseTo(72319.6, 2);
    const row = (label: string) => -s.breakdown.rows.find((x: { label: string }) => x.label === label).values[0] * 26;
    expect(Math.abs(row("Federal income tax") - 13170)).toBeLessThanOrEqual(1);
    expect(Math.abs(row("Social Security") - 6200)).toBeLessThanOrEqual(1);
    expect(Math.abs(row("Medicare") - 1450)).toBeLessThanOrEqual(1);
    expect(Math.abs(row("CA SDI") - 1300)).toBeLessThanOrEqual(1);
    expect(Math.abs(row("State income tax") - 5560.48)).toBeLessThanOrEqual(1);
    expect(text(r)).toContain("Data by CalcBloc");
  });
});
