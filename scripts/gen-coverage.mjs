#!/usr/bin/env node
/**
 * Writes src/coverage.generated.ts from GET /api/v1/countries, so the tool descriptions quote the API's own counts,
 * region requirements and option values instead of typed-in numbers.
 *
 *   node scripts/gen-coverage.mjs                       # live API (https://calcbloc.com/api/v1/countries)
 *   node scripts/gen-coverage.mjs test/fixtures/countries.json
 *   node scripts/gen-coverage.mjs --site=../calcbloc --save=test/fixtures/countries.json
 *                                                       # the site repo's own API code, before it is deployed
 *   node scripts/gen-coverage.mjs --check [source]      # exit 1 if the file is out of date
 *
 * --site runs GET /api/v1/countries in-process from a checkout of the calcbloc.com repository (its handleApiRequest,
 * through the repository's own tsx, with an in-memory key store), so the coverage of an API version that is not live
 * yet can be generated from its definitions; nothing in that repository is written. --save also writes the payload
 * (the test fixture the generated file is checked against).
 *
 * Run before every release: from --site while the matching API version is not live, from the live API after it is.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const check = args.includes("--check");
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const site = flag("site");
const save = flag("save");
const src = site ? `the calcbloc.com repository's local GET /api/v1/countries` : (args.find((a) => !a.startsWith("--")) ?? "https://calcbloc.com/api/v1/countries");
const OUT = new URL("../src/coverage.generated.ts", import.meta.url);

/** GET /api/v1/countries answered by the site repository's own router, run in a child process from that checkout. */
function fromSite(dir) {
  const root = resolve(dir);
  const router = pathToFileURL(join(root, "src", "lib", "api", "router.ts")).href;
  const tmp = mkdtempSync(join(tmpdir(), "calcbloc-coverage-"));
  const out = join(tmp, "countries.json");
  const code = [
    'import { writeFileSync } from "node:fs";',
    `const { handleApiRequest } = await import(${JSON.stringify(router)});`,
    'const res = await handleApiRequest(new Request("https://calcbloc.com/api/v1/countries"), ["countries"]);',
    'if (!res.ok) throw new Error(`GET /countries answered ${res.status}`);',
    `writeFileSync(${JSON.stringify(out)}, await res.text());`,
  ].join("\n");
  // No Redis: the router falls back to an in-memory key and rate-limit store.
  const env = { ...process.env };
  delete env.REDIS_URL;
  try {
    // react-server: the site's modules import "server-only"; tsx resolves its @/ and @data/ paths from its tsconfig.
    execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", code], { cwd: root, stdio: ["ignore", "ignore", "inherit"], env });
    return JSON.parse(readFileSync(out, "utf8"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const payload = site
  ? fromSite(site)
  : src.startsWith("http")
    ? await (await fetch(src, { headers: { "User-Agent": "calcbloc-mcp gen-coverage" } })).json()
    : JSON.parse(readFileSync(src, "utf8"));
if (save) writeFileSync(save, `${JSON.stringify(payload, null, 2)}\n`);
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
// API 1.9: cross-border equity (/cross-border-equity; the countries with a tax estimate are listed in coverage only) and
// the tax calendar (tax_calendar on each country of /countries).
const crossBorderCountries = cov?.cross_border_countries ?? [];
const taxCalendar = countries.filter((c) => !!c.tax_calendar);
// The scope note the calculation tools quote (src/constants.ts NOT_SUPPORTED), generated so the country lists stay current.
// API 1.10 serves treaty withholding limits (/tax-treaties, get_tax_treaties); /countries has no treaty coverage, so the
// note names the tool rather than the countries.
const notYetSupported = crossBorderCountries.length
  ? "Not yet supported: cross-border salary withholding (multi-country payroll), and the double-tax relief amount (get_tax_treaties lists the treaty withholding limits CalcBloc stores)."
  : "Not yet supported: cross-border (multi-country) withholding.";
const notSupported =
  `Bonus and other supplemental pay (withholding vs final tax): calculate_supplemental_withholding (${listOr(supplemental.map(short))}). ` +
  `Equity compensation (RSUs, stock options): calculate_equity_tax (${listOr(equity.map(short))}). ` +
  (crossBorderCountries.length ? `Equity earned while working in several countries: calculate_cross_border_equity (tax estimates for ${listOr(crossBorderCountries)}). ` : "") +
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
  crossBorder: crossBorderCountries.length,
  crossBorderCountries,
  taxCalendar: taxCalendar.length,
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
  `- **Cross-border equity** (\`calculate_cross_border_equity\`: an RSU vest or option exercise split between the countries worked in from grant to vest, with each share's estimated tax): ${data.crossBorderCountries.length ? `tax estimates for ${codes(data.crossBorderCountries)}; the split itself works for every country` : "none yet"}.`,
  `- **Tax tables** (\`get_tax_tables\`) and **tax facts** (\`search_tax_facts\`): all ${data.taxTables} countries; the others say so and link their tax tables when a calculation is asked for.`,
  `- **Tax calendar** (\`get_tax_calendar\`: tax year, next tax year, enacted and announced changes, next budget): ${data.taxCalendar ? `${data.taxCalendar === data.taxTables ? "all " : ""}${data.taxCalendar} countries` : "none yet"}.`,
  "- **Import duty, tariffs and trade agreements** (`calculate_import_duty`, `get_tariff`, `list_trade_agreements`): imports into the UK, the EU (any member state), the United States and India, as the API's tariff data allows.",
  "- **Tax treaties** (`get_tax_treaties`: withholding limits on dividends, interest, royalties and technical fees, relief method, dates and MLI status): the double taxation treaties the API stores (India's with the United States, Singapore, the United Kingdom, Japan, Australia and Austria in API 1.10).",
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
  // Line endings are ignored: a Windows checkout (core.autocrlf) has CRLF where the generator writes LF.
  const lf = (s) => s.replace(/\r\n/g, "\n");
  const body = (s) => lf(s.slice(s.indexOf("export")));
  if (body(cur) !== body(text) || lf(readme) !== lf(newReadme)) {
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
