import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CalcBlocClient } from "../src/api.js";
import { ATTRIBUTION } from "../src/constants.js";
import { pageLink, tagPageLinks } from "../src/format.js";
import { compareCountries, employerCost, listCountries, takeHomePay, taxTables } from "../src/tools.js";
import { mockFetch, route } from "./mock-api.js";

const client = (override?: Parameters<typeof mockFetch>[0], apiKey?: string) => {
  const m = mockFetch(override);
  return { api: new CalcBlocClient({ apiUrl: "https://calcbloc.test/api/v1", fetch: m.fetch, apiKey }), calls: m.calls };
};

const text = (r: { content: { text: string }[] }) => r.content.map((c) => c.text).join("\n");

/** Every successful result must carry the tax year, official sources, the CalcBloc page and the credit. */
function expectCredit(r: Awaited<ReturnType<typeof takeHomePay>>) {
  expect(r.isError).toBeFalsy();
  const s = r.structuredContent as Record<string, unknown>;
  expect(s.taxYear).toBeTruthy();
  expect(s.attribution).toBe(ATTRIBUTION);
  expect(String(s.calcblocUrl)).toMatch(/^https:\/\/calcbloc\.com\//);
  expect(String(s.disclaimer)).toMatch(/not tax/);
  const t = text(r);
  expect(t).toContain("Data by CalcBloc");
  expect(t).toContain("not tax, legal or financial advice");
  expect(t).toContain(String(s.taxYear).split(" ")[0]);
}

describe("calculate_take_home_pay", () => {
  it("returns net pay with tax year, official sources and attribution", async () => {
    const { api, calls } = client();
    const r = await takeHomePay(api, { country: "United Kingdom", gross_salary: 50000, region: "Scotland" });
    expectCredit(r);
    const s = r.structuredContent as Record<string, any>;
    expect(s.taxYear).toBe("2026-27");
    expect(s.netAnnual).toBe(38024.07);
    expect(s.region).toBe("scotland");
    expect(s.sources.length).toBeGreaterThan(0);
    expect(s.sources.every((x: { url: string }) => x.url.startsWith("https://"))).toBe(true);
    // Scottish rates come from the Scottish table, which is linked as the tax-tables page.
    expect(s.taxTablesUrl).toContain("/uk/tax-tables/2026-27/scotland");
    expect(s.sources.some((x: { url: string }) => /gov\.scot|revenue\.scot|gov\.uk/.test(x.url))).toBe(true);
    const ns = calls.find((c) => c.path === "/net-salary")!;
    expect(ns.query).toMatchObject({ country: "uk", salary: "50000", region: "scotland", year: "2026-27" });
    expect(text(r)).toContain("GBP 38,024.07");
  });

  it("caches the country list and tax tables between calls", async () => {
    const { api, calls } = client();
    await takeHomePay(api, { country: "uk", gross_salary: 50000, region: "scotland" });
    await takeHomePay(api, { country: "uk", gross_salary: 50000, region: "scotland" });
    expect(calls.filter((c) => c.path === "/countries")).toHaveLength(1);
    expect(calls.filter((c) => c.path.startsWith("/tax-tables"))).toHaveLength(2);
    expect(calls.filter((c) => c.path === "/net-salary")).toHaveLength(2);
  });

  it("passes and validates country-specific options", async () => {
    const { api, calls } = client();
    const r = await takeHomePay(api, { country: "uk", gross_salary: 50000, options: { pensionPct: "5", student_loan: "Plan2", postgraduate_loan: "no" } });
    expect(r.isError).toBeFalsy();
    expect(calls.find((c) => c.path === "/net-salary")!.query).toMatchObject({ pension_pct: "5", student_loan: "plan2", postgraduate_loan: "false" });

    const bad = await takeHomePay(api, { country: "uk", gross_salary: 50000, options: { filing_status: "single" } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain("student_loan");
    const range = await takeHomePay(api, { country: "uk", gross_salary: 50000, options: { pension_pct: 150 } });
    expect(range.isError).toBe(true);
    expect(text(range)).toContain("above 100");
  });

  it("explains tables-only countries without calling the calculation endpoint", async () => {
    const { api, calls } = client();
    const r = await takeHomePay(api, { country: "Austria", gross_salary: 50000 });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("not available for Austria yet");
    expect(text(r)).toContain("https://calcbloc.com/austria/tax-tables/2026");
    expect(text(r)).toContain("get_tax_tables");
    expect(calls.some((c) => c.path === "/net-salary")).toBe(false);
  });

  it("points earlier years to the tax tables", async () => {
    const { api } = client();
    const r = await takeHomePay(api, { country: "uk", gross_salary: 50000, year: "2025/26" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("current tax year (2026-27)");
    expect(text(r)).toContain("https://calcbloc.com/uk/tax-tables/2025-26");
  });

  it("rejects unknown countries and regions with the valid choices", async () => {
    const { api } = client();
    const r = await takeHomePay(api, { country: "Atlantis", gross_salary: 50000 });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("new-zealand (New Zealand)");
    const reg = await takeHomePay(api, { country: "uk", gross_salary: 50000, region: "cornwall" });
    expect(reg.isError).toBe(true);
    expect(text(reg)).toContain("scotland");
  });

  it("still answers when the source lookup fails, with a warning", async () => {
    const { api } = client((u) => (u.pathname.includes("/tax-tables/") ? { status: 500, body: { error: { code: "internal_error", message: "boom" } } } : undefined));
    const r = await takeHomePay(api, { country: "uk", gross_salary: 50000 });
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent as Record<string, any>;
    expect(s.sources).toEqual([]);
    expect(s.warnings.join(" ")).toContain("https://calcbloc.com/uk/tax-tables/2026-27");
    expect(text(r)).toContain("Data by CalcBloc");
  });

  it("turns HTTP 429 into advice about the free API key", async () => {
    const { api } = client((u) =>
      u.pathname.endsWith("/net-salary") ? { status: 429, headers: { "Retry-After": "120" }, body: { error: { code: "rate_limited", message: "Too many requests" } } } : undefined,
    );
    const r = await takeHomePay(api, { country: "uk", gross_salary: 50000 });
    expect(r.isError).toBe(true);
    const t = text(r);
    expect(t).toContain("rate limit");
    expect(t).toContain("2 minutes");
    expect(t).toContain("CALCBLOC_API_KEY");
    expect(t).toContain("https://calcbloc.com/developers/keys");
  });

  it("says calculations need the API when only the local data folder is available", async () => {
    const dir = fileURLToPath(new URL("./fixtures/offline-data/", import.meta.url));
    const api = new CalcBlocClient({
      dataDir: dir,
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    const r = await takeHomePay(api, { country: "uk", gross_salary: 50000 });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Calculations need the CalcBloc API");
    const t = await taxTables(api, { country: "uk", group: "income-tax" });
    expect(t.isError).toBeFalsy();
    expect((t.structuredContent as Record<string, any>).dataOrigin).toBe("local");
    expect(text(t)).toContain("CALCBLOC_DATA_DIR");
  });

  it("sends the API key header when configured", async () => {
    const { api, calls } = client(undefined, "cb_test_123");
    await takeHomePay(api, { country: "uk", gross_salary: 50000 });
    expect(calls.every((c) => c.apiKey === "cb_test_123")).toBe(true);
  });
});

describe("calculate_employer_cost", () => {
  it("returns the total cost with sources from the employer sections", async () => {
    const { api } = client();
    const r = await employerCost(api, { country: "de", gross_salary: 60000 });
    expectCredit(r);
    const s = r.structuredContent as Record<string, any>;
    expect(s.totalCost).toBe(73392);
    expect(s.taxYear).toBe("2026");
    expect(s.calcblocUrl).toBe("https://calcbloc.com/germany/germany-employer-cost-calculator?utm_source=calcbloc-mcp&utm_medium=app&utm_campaign=itmarkerz-oss");
    expect(s.sources.length).toBeGreaterThan(0);
    expect(text(r)).toContain("EUR 73,392.00");
  });

  it("passes the state for German employer cost", async () => {
    const { api, calls } = client();
    const r = await employerCost(api, { country: "germany", gross_salary: 60000, region: "by" });
    expect(r.isError).toBeFalsy();
    expect(calls.find((c) => c.path === "/employer-cost")!.query.region).toBe("by");
  });

  it("ignores a region where employer cost does not vary by region, with a warning", async () => {
    const { api, calls } = client((u) => (u.pathname.endsWith("/employer-cost") ? route(new URL("https://x/api/v1/employer-cost?country=germany")) : undefined));
    const r = await employerCost(api, { country: "uk", gross_salary: 40000, region: "scotland" });
    expect(r.isError).toBeFalsy();
    expect(calls.find((c) => c.path === "/employer-cost")!.query.region).toBeUndefined();
    expect((r.structuredContent as Record<string, any>).warnings.join(" ")).toContain("does not vary by region");
  });
});

describe("compare_countries", () => {
  it("compares two countries with both tax years and both sets of sources", async () => {
    const { api, calls } = client();
    const r = await compareCountries(api, { country_a: "uk", country_b: "germany", gross_salary: 50000 });
    expectCredit(r);
    const s = r.structuredContent as Record<string, any>;
    expect(s.taxYear).toBe("2026-27 (United Kingdom) / 2026 (Germany)");
    expect(s.a.net).toBe(39520.12);
    expect(s.b.currency).toBe("EUR");
    expect(s.exchangeRate.pair).toBe("GBP_EUR");
    const urls = s.sources.map((x: { url: string }) => x.url).join(" ");
    expect(urls).toContain("gov.uk");
    expect(urls).toMatch(/\.de\//);
    expect(calls.find((c) => c.path === "/compare")!.query).toMatchObject({ a: "uk", b: "germany", salary: "50000", currency: "GBP" });
  });

  it("maps regions to the comparison's region parameters", async () => {
    const { api, calls } = client();
    await compareCountries(api, { country_a: "uk", country_b: "germany", gross_salary: 50000, region_a: "scotland", region_b: "by" });
    const q = calls.find((c) => c.path === "/compare")!.query;
    expect(q.uk_region).toBe("scotland");
    expect(q.region).toBeUndefined();
  });

  it("rejects the same country twice, a wrong currency and tables-only countries", async () => {
    const { api } = client();
    expect((await compareCountries(api, { country_a: "uk", country_b: "gb", gross_salary: 1 })).isError).toBe(true);
    const cur = await compareCountries(api, { country_a: "uk", country_b: "germany", gross_salary: 1, currency: "USD" });
    expect(text(cur)).toContain("GBP");
    const tables = await compareCountries(api, { country_a: "uk", country_b: "norway", gross_salary: 1 });
    expect(text(tables)).toContain("https://calcbloc.com/norway/tax-tables/2026");
  });
});

describe("get_tax_tables", () => {
  it("returns sections with sources, year and the page link", async () => {
    const { api } = client();
    const r = await taxTables(api, { country: "uk" });
    expectCredit(r);
    const s = r.structuredContent as Record<string, any>;
    expect(s.taxYear).toBe("2026-27");
    expect(s.truncated).toBe(false);
    expect(s.sections.length).toBe(s.sectionIndex.length);
    expect(s.calcblocUrl).toBe("https://calcbloc.com/uk/tax-tables/2026-27?utm_source=calcbloc-mcp&utm_medium=app&utm_campaign=itmarkerz-oss");
    expect(text(r)).toContain("Page: https://calcbloc.com/uk/tax-tables/2026-27?utm_source=calcbloc-mcp&utm_medium=app&utm_campaign=itmarkerz-oss");
    expect(s.csvUrl).toContain("format=csv");
    expect(text(r)).toContain("Basic rate: 0 to 37,700 at 20%");
    expect(text(r)).toContain("Personal Allowance: GBP 12,570.00");
  });

  it("filters by group and returns regional tables", async () => {
    const { api, calls } = client();
    const r = await taxTables(api, { country: "uk", region: "Scotland", group: "income-tax" });
    const s = r.structuredContent as Record<string, any>;
    expect(s.region).toBe("scotland");
    expect(s.sections.every((x: { group: string }) => x.group === "income-tax")).toBe(true);
    expect(calls.find((c) => c.path.startsWith("/tax-tables"))!.query.region).toBe("scotland");
  });

  it("serves the national table for England", async () => {
    const { api } = client();
    const r = await taxTables(api, { country: "uk", region: "england" });
    expect((r.structuredContent as Record<string, any>).region).toBeNull();
  });

  it("works for tables-only countries via the API", async () => {
    const { api } = client((u) => (u.pathname.endsWith("/tax-tables/austria/2026") ? { status: 200, body: { ...tableStub("austria", "Austria", "2026") } } : undefined));
    const r = await taxTables(api, { country: "austria" });
    expect(r.isError).toBeFalsy();
    expect((r.structuredContent as Record<string, any>).sources[0].url).toBe("https://www.bmf.gv.at/");
  });

  it("returns only the section index for very long tables, and full sections when filtered", async () => {
    const { api } = client();
    const full = await taxTables(api, { country: "india" });
    const s = full.structuredContent as Record<string, any>;
    expect(s.truncated).toBe(true);
    expect(s.sections).toEqual([]);
    expect(s.sectionIndex.length).toBeGreaterThan(20);
    expect(s.warnings.join(" ")).toContain("group");
    expect(text(full)).toContain("new-regime [income-tax]");
    const filtered = await taxTables(api, { country: "india", group: "income-tax" });
    expect((filtered.structuredContent as Record<string, any>).truncated).toBe(false);
    expect(text(filtered)).toContain("400,000 to 800,000 at 5%");
    expect(text(filtered)).not.toContain("undefined");
  });

  it("rejects years that are not published", async () => {
    const { api } = client();
    const r = await taxTables(api, { country: "germany", year: "2019" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("2026");
  });
});

describe("list_countries", () => {
  it("lists every live country and the tools available for each", async () => {
    const { api } = client();
    const r = await listCountries(api, {});
    const s = r.structuredContent as Record<string, any>;
    expect(s.countries.length).toBe(24);
    expect(s.countries.find((c: { code: string }) => c.code === "austria")).toMatchObject({ takeHomePay: false, taxTables: true });
    expect(text(r)).toContain("Data by CalcBloc");
  });

  it("describes a country's regions and options", async () => {
    const { api } = client();
    const r = await listCountries(api, { country: "us" });
    const t = text(r);
    expect(t).toContain("filing_status");
    expect(t).toContain("ca (California)");
    const s = r.structuredContent as Record<string, any>;
    expect(s.details.takeHomePay.regions).toContain("ny");
  });
});

function tableStub(country: string, name: string, year: string) {
  return {
    country,
    countryName: name,
    year,
    yearLabel: year,
    region: null,
    currency: "EUR",
    status: "verified",
    underReview: [],
    sections: [
      {
        id: "income-tax",
        title: "Income tax",
        group: "income-tax",
        kind: "bands",
        rows: [{ label: "Band 1", from: 0, to: 13308, rate: 0 }],
        source: { title: "BMF", url: "https://www.bmf.gv.at/", retrievedAt: "2026-11-01" },
      },
    ],
    sources: [{ title: "BMF", url: "https://www.bmf.gv.at/" }],
    pageUrl: `https://calcbloc.com/${country}/tax-tables/${year}`,
  };
}

describe("page links", () => {
  const tag = "utm_source=calcbloc-mcp&utm_medium=app&utm_campaign=itmarkerz-oss";
  it("tags calcbloc.com pages and leaves API, download and other links alone", () => {
    expect(pageLink("https://calcbloc.com")).toBe(`https://calcbloc.com/?${tag}`);
    expect(pageLink("https://calcbloc.com/developers#limits")).toBe(`https://calcbloc.com/developers?${tag}#limits`);
    expect(pageLink("https://calcbloc.com/x?a=1")).toBe(`https://calcbloc.com/x?a=1&${tag}`);
    expect(pageLink(`https://calcbloc.com/data?${tag}`)).toBe(`https://calcbloc.com/data?${tag}`);
    expect(pageLink("https://calcbloc.com/api/v1/tax-tables/uk/2026-27?format=csv")).toBe("https://calcbloc.com/api/v1/tax-tables/uk/2026-27?format=csv");
    expect(pageLink("https://www.gov.uk/income-tax-rates")).toBe("https://www.gov.uk/income-tax-rates");
  });
  it("keeps sentence punctuation outside the link", () => {
    expect(tagPageLinks("See https://calcbloc.com/austria/tax-tables/2026.")).toBe(`See https://calcbloc.com/austria/tax-tables/2026?${tag}.`);
  });
});
