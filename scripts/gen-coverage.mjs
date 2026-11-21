#!/usr/bin/env node
/**
 * Writes src/coverage.generated.ts from GET /api/v1/countries, so the tool descriptions quote the API's own counts,
 * region requirements and option values instead of typed-in numbers.
 *
 *   node scripts/gen-coverage.mjs                       # live API (https://calcbloc.com/api/v1/countries)
 *   node scripts/gen-coverage.mjs test/fixtures/countries.json
 *   node scripts/gen-coverage.mjs --check [source]      # exit 1 if the file is out of date
 *
 * Run before every release, after the site carrying the matching API version is live.
 */
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const check = args.includes("--check");
const src = args.find((a) => !a.startsWith("--")) ?? "https://calcbloc.com/api/v1/countries";
const OUT = new URL("../src/coverage.generated.ts", import.meta.url);

const payload = src.startsWith("http")
  ? await (await fetch(src, { headers: { "User-Agent": "calcbloc-mcp gen-coverage" } })).json()
  : JSON.parse(readFileSync(src, "utf8"));
const countries = payload.countries;
if (!Array.isArray(countries) || !countries.length) throw new Error("no countries in the payload");

const short = (c) => c.short_code ?? c.code;
const has = (c, e) => (c.available_endpoints ?? []).includes(e);
const regionNeed = (e, required) =>
  countries.filter((c) => c.endpoints[e]?.parameters.some((p) => p.name === "region" && !!p.required === required)).map(short);
const cov = payload.coverage;
const netSalary = countries.filter((c) => has(c, "net-salary"));
const employer = countries.filter((c) => has(c, "employer-cost"));
const compare = countries.filter((c) => has(c, "compare"));
const partial = netSalary.filter((c) => !has(c, "employer-cost")).map((c) => c.name);

// API 1.8: supplemental withholding (endpoints["supplemental-withholding"]) and equity tax (equity_tax, outside `endpoints`).
const SUPP = "supplemental-withholding";
const supplemental = countries.filter((c) => !!c.endpoints[SUPP]);
const equity = countries.filter((c) => !!c.equity_tax);
const paramsOf = (c, kind) => (kind === "equity-tax" ? c.equity_tax?.parameters : c.endpoints[kind]?.parameters) ?? [];
const regionNeedOf = (list, kind, required) => list.filter((c) => paramsOf(c, kind).some((p) => p.name === "region" && !!p.required === required)).map(short);
const union = (lists) => [...new Set(lists.flat())];
const supplementalTypes = Object.fromEntries(supplemental.map((c) => [short(c), c.endpoints[SUPP].types ?? paramsOf(c, SUPP).find((p) => p.name === "type")?.values ?? []]));
const equityInstruments = Object.fromEntries(equity.map((c) => [short(c), c.equity_tax.instruments ?? []]));
const listOr = (codes) => (codes.length ? codes.join(", ") : "none yet");
// The scope note the calculation tools quote (src/constants.ts NOT_SUPPORTED), generated so the country lists stay current.
const notYetSupported = "Not yet supported: cross-border (multi-country) withholding.";
const notSupported =
  `Bonus and other supplemental pay (withholding vs final tax): calculate_supplemental_withholding (${listOr(supplemental.map(short))}). ` +
  `Equity compensation (RSUs, stock options): calculate_equity_tax (${listOr(equity.map(short))}). ` +
  notYetSupported;

const option = (code, endpoint, name) => countries.find((c) => c.code === code)?.endpoints[endpoint]?.parameters.find((p) => p.name === name)?.values ?? [];

const data = {
  taxTables: countries.length,
  netSalary: netSalary.length,
  employerCost: employer.length,
  compare: compare.length,
  summary:
    cov?.summary ??
    `${countries.length} countries with official tax tables; ${netSalary.length} with take-home pay calculations; ${employer.length} with employer cost; ${compare.length} in the cross-country comparison${partial.length ? ` (${partial.join(", ")}: take-home pay and compare only, no employer cost yet)` : ""}.`,
  netSalaryCountries: netSalary.map(short),
  employerCostCountries: employer.map(short),
  compareCountries: compare.map(short),
  regionRequired: { "net-salary": regionNeed("net-salary", true), "employer-cost": regionNeed("employer-cost", true) },
  regionOptional: { "net-salary": regionNeed("net-salary", false), "employer-cost": regionNeed("employer-cost", false) },
  supplemental: supplemental.length,
  supplementalCountries: supplemental.map(short),
  supplementalTypes,
  supplementalTypeValues: union(Object.values(supplementalTypes)),
  equity: equity.length,
  equityCountries: equity.map(short),
  equityInstruments,
  equityInstrumentValues: union(Object.values(equityInstruments)),
  regionRequiredExtra: { "supplemental-withholding": regionNeedOf(supplemental, SUPP, true), "equity-tax": regionNeedOf(equity, "equity-tax", true) },
  regionOptionalExtra: { "supplemental-withholding": regionNeedOf(supplemental, SUPP, false), "equity-tax": regionNeedOf(equity, "equity-tax", false) },
  notSupported,
  notYetSupported,
  shortCodes: Object.fromEntries(countries.map((c) => [c.code, short(c)])),
  examples: {
    usFilingStatus: option("us", "net-salary", "filing_status"),
    ukStudentLoan: option("uk", "net-salary", "student_loan"),
    deTaxClass: option("germany", "net-salary", "tax_class"),
    usSupplementalFilingStatus: option("us", SUPP, "filing_status"),
    usSupplementalMethod: option("us", SUPP, "method"),
  },
};

const text = `// Generated by scripts/gen-coverage.mjs from ${src.startsWith("http") ? src : "a /api/v1/countries payload"}. Do not edit by hand.
export const COVERAGE = ${JSON.stringify(data, null, 2)} as const;
`;

const codes = (list) => list.map((c) => `\`${c}\``).join(", ");
const regionExtra = (kind, label) => (data.regionRequiredExtra[kind].length ? `; for ${label} in ${codes(data.regionRequiredExtra[kind])}` : "");
const readmeBlock = [
  "<!-- coverage:start -->",
  "<!-- Generated by scripts/gen-coverage.mjs from GET /api/v1/countries. Do not edit by hand. -->",
  `${data.summary}`,
  "",
  `- **Take-home pay** (\`calculate_take_home_pay\`): ${data.netSalaryCountries.map((c) => `\`${c}\``).join(", ")}.`,
  `- **Employer cost** (\`calculate_employer_cost\`): ${data.employerCostCountries.map((c) => `\`${c}\``).join(", ")}.`,
  `- **Compare** (\`compare_countries\`): ${data.compareCountries.map((c) => `\`${c}\``).join(", ")}.`,
  `- **Supplemental withholding** (\`calculate_supplemental_withholding\`: tax withheld on a bonus, commission, RSU vest, option exercise or lump sum, next to the final tax it adds): ${data.supplementalCountries.length ? codes(data.supplementalCountries) : "none yet"}.`,
  `- **Equity tax** (\`calculate_equity_tax\`: RSUs and stock options at vest or exercise, and on sale): ${data.equityCountries.length ? data.equityCountries.map((c) => `\`${c}\` (${data.equityInstruments[c].join(", ")})`).join(", ") : "none yet"}.`,
  `- **Tax tables** (\`get_tax_tables\`): all ${data.taxTables} countries; the others say so and link their tax tables when a calculation is asked for.`,
  `- **\`region\` is required** for take-home pay in ${codes(data.regionRequired["net-salary"])}; for employer cost in ${codes(data.regionRequired["employer-cost"])}${regionExtra("supplemental-withholding", "supplemental withholding")}${regionExtra("equity-tax", "equity tax")}. A missing or unknown region returns the valid codes and names.`,
  `- ${notYetSupported}`,
  "",
  "`list_countries` always shows the live list.",
  "<!-- coverage:end -->",
].join("\n");
const README = new URL("../README.md", import.meta.url);
const readme = readFileSync(README, "utf8");
const newReadme = readme.replace(/<!-- coverage:start -->[\s\S]*?<!-- coverage:end -->/, readmeBlock);
if (!readme.includes("<!-- coverage:start -->")) throw new Error("README.md has no coverage markers");

// Registry and plugin manifests quote the country count in their one-line descriptions.
const MANIFESTS = ["../package.json", "../server.json", "../plugin/.claude-plugin/plugin.json"].map((p) => new URL(p, import.meta.url));
const manifestUpdates = MANIFESTS.map((u) => {
  const cur = readFileSync(u, "utf8");
  const next = cur.replace(/("description": "[^"]*?\b)\d+( countries\b)/, `$1${data.taxTables}$2`);
  return { u, cur, next };
});

if (check) {
  const stale = manifestUpdates.filter((m) => m.cur !== m.next);
  if (stale.length) {
    console.error(`country count out of date in ${stale.map((m) => m.u.pathname.split("/").slice(-2).join("/")).join(", ")}: run node scripts/gen-coverage.mjs`);
    process.exit(1);
  }
  const cur = readFileSync(OUT, "utf8");
  // The source line differs between a live and a file run; compare the data only.
  const body = (s) => s.slice(s.indexOf("export"));
  if (body(cur) !== body(text) || readme !== newReadme) {
    console.error("src/coverage.generated.ts or the README coverage block is out of date: run node scripts/gen-coverage.mjs");
    process.exit(1);
  }
  console.log("coverage.generated.ts and README coverage are up to date");
} else {
  writeFileSync(OUT, text);
  writeFileSync(README, newReadme);
  for (const m of manifestUpdates) if (m.cur !== m.next) writeFileSync(m.u, m.next);
  console.log(`coverage: ${data.summary}`);
}
