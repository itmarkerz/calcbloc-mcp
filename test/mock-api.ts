import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

export interface MockReply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface RecordedRequest {
  path: string;
  query: Record<string, string>;
  apiKey: string | null;
}

/** Answers like the CalcBloc API, from responses captured from https://calcbloc.com/api/v1 and the calcbloc-data tables. */
export function route(url: URL): MockReply {
  const path = url.pathname.replace(/^.*\/api\/v1/, "");
  const q = url.searchParams;
  if (path === "/countries") return { status: 200, body: fixture("countries.json") };
  if (path === "/net-salary") {
    if (q.get("country") === "uk") return { status: 200, body: fixture("net-salary-uk.json") };
    if (q.get("country") === "austria") return { status: 400, body: fixture("net-salary-austria.json") };
    if (q.get("country") === "us" && !q.get("region")) return { status: 400, body: fixture("net-salary-us-missing-region.json") };
    if (q.get("country") === "us" && q.get("region") === "ca") return { status: 200, body: fixture("net-salary-us-ca.json") };
  }
  if (path === "/employer-cost" && q.get("country") === "germany") return { status: 200, body: fixture("employer-cost-germany.json") };
  if (path === "/compare" && q.get("a") === "uk" && q.get("b") === "germany") return { status: 200, body: fixture("compare-uk-germany.json") };
  // API 1.8 (captured from the site's local main with handleApiRequest, before the 1.8.0 release).
  if (path === "/supplemental-withholding") {
    const c = q.get("country");
    if (c === "us" && !q.get("region")) return { status: 400, body: fixture("supplemental-us-missing-region.json") };
    if (c === "us" && q.get("region") === "ca" && q.get("amount") === "1500000") return { status: 200, body: fixture("supplemental-us-1m.json") };
    if (c === "us" && q.get("region") === "ca") return { status: 200, body: fixture("supplemental-us-ca.json") };
    if (c === "uk") return { status: 200, body: fixture("supplemental-uk.json") };
    if (c === "germany") return { status: 200, body: fixture("supplemental-de.json") };
    if (c === "australia" && q.get("type") === "rsu_vest") return { status: 400, body: fixture("supplemental-unsupported-type.json") };
    if (c === "italy") return { status: 400, body: fixture("supplemental-unsupported-country.json") };
  }
  if (path === "/equity-tax") {
    const c = q.get("country");
    const i = q.get("instrument");
    if (c === "us" && !q.get("fmv_event")) return { status: 400, body: fixture("equity-missing-parameter.json") };
    if (c === "us" && i === "rsu") return { status: 200, body: fixture("equity-us-rsu.json") };
    if (c === "us" && i === "iso") return { status: 200, body: fixture("equity-us-iso.json") };
    if (c === "uk" && i === "emi") return { status: 200, body: fixture("equity-uk-emi.json") };
    if (c === "germany") return { status: 400, body: fixture("equity-unsupported-country.json") };
  }
  // API 1.9 (captured from the site's local main with handleApiRequest and the calcbloc-data tariff shards, before the
  // 1.9.0 release; the tax calendar is as of 2026-11-26).
  const dest = q.get("destination") ?? q.get("importer");
  if (path === "/tariffs") {
    const code = q.get("code");
    if (code === "0000") return { status: 404, body: fixture("tariffs-gb-0000.json") };
    if (dest === "gb" && code === "0901" && q.get("origin") === "in") return { status: 200, body: fixture("tariffs-gb-0901-in.json") };
    if (dest === "gb" && code === "0901" && !q.get("origin")) return { status: 200, body: fixture("tariffs-gb-0901.json") };
    if (dest === "us" && code === "940320" && q.get("origin") === "cn") return { status: 200, body: fixture("tariffs-us-940320-cn.json") };
  }
  if (path === "/trade-agreements") {
    if (q.get("country") === "us" && !q.get("partner")) return { status: 200, body: fixture("trade-agreements-us.json") };
    if (q.get("country") === "gb" && q.get("partner") === "in") return { status: 200, body: fixture("trade-agreements-gb-in.json") };
  }
  if (path === "/import-duty") {
    const key = `${dest}/${q.get("origin")}/${q.get("code")}`;
    if (dest === "jp") return { status: 400, body: fixture("import-duty-unsupported-destination.json") };
    if (dest === "in") return { status: 503, body: fixture("import-duty-in-unavailable.json"), headers: { "Retry-After": "3600" } };
    if (q.get("code") === "0901") return { status: 400, body: fixture("import-duty-gb-ambiguous.json") };
    const file = ({
      "gb/in/0901210000": "import-duty-gb-coffee-in.json",
      "gb/de/2203000100": "import-duty-gb-beer.json",
      "de/cn/7318154210": "import-duty-de-screws-cn.json",
      "eu/us/8471300000": "import-duty-eu-laptop-us.json",
      "us/cn/9403200050": "import-duty-us-furniture-cn.json",
    } as Record<string, string>)[key];
    if (file) return { status: 200, body: fixture(file) };
  }
  if (path === "/tax-calendar") {
    if (q.get("country") === "uk" && !q.get("region")) return { status: 200, body: fixture("tax-calendar-uk.json") };
    if (q.get("country") === "us" && q.get("region") === "ca") return { status: 200, body: fixture("tax-calendar-us-ca.json") };
    return { status: 400, body: fixture("tax-calendar-unknown-country.json") };
  }
  if (path === "/facts") {
    if (q.get("tax_type") === "nonsense") return { status: 400, body: fixture("facts-unknown-tax-type.json") };
    if (q.get("country") === "uk" && q.get("tax_type") === "income.pit") return { status: 200, body: fixture("facts-uk-income-pit.json") };
    if (q.get("jurisdiction") === "us-ca") return { status: 200, body: fixture("facts-us-ca-consumption.json") };
  }
  if (path === "/cross-border-equity") {
    if (q.get("instrument") === "rsu") return { status: 200, body: fixture("cross-border-us-uk-rsu.json") };
    if (q.get("instrument") === "stock_option") return { status: 200, body: fixture("cross-border-ca-us-option.json") };
  }
  const t = path.match(/^\/tax-tables\/([a-z-]+)\/([0-9a-z-]+)$/);
  if (t) {
    const [, country, yearRaw] = t;
    const year = yearRaw === "latest" ? ({ uk: "2026-27", germany: "2026", india: "2026-27" } as Record<string, string>)[country!] : yearRaw;
    const region = q.get("region");
    try {
      return { status: 200, body: fixture(`table-${country}-${year}${region ? `-${region}` : ""}.json`) };
    } catch {
      /* fall through */
    }
  }
  return { status: 404, body: { error: { code: "not_found", message: `No mock for ${path}?${q}`, docs: "https://calcbloc.com/developers" } } };
}

/** A fetch replacement that serves `route` (or `override` first) and records each request. */
export function mockFetch(override?: (url: URL) => MockReply | undefined) {
  const calls: RecordedRequest[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    calls.push({ path: url.pathname.replace(/^.*\/api\/v1/, ""), query: Object.fromEntries(url.searchParams), apiKey: headers.get("x-api-key") });
    const r = override?.(url) ?? route(url);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json", ...r.headers } });
  }) as typeof fetch;
  return { fetch: fn, calls };
}

/** The same routes over HTTP, for the stdio integration test (the server runs in a child process). */
export async function startMockServer(): Promise<{ url: string; calls: RecordedRequest[]; close: () => Promise<void>; server: Server }> {
  const calls: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    calls.push({ path: url.pathname.replace(/^.*\/api\/v1/, ""), query: Object.fromEntries(url.searchParams), apiKey: (req.headers["x-api-key"] as string) ?? null });
    const r = route(url);
    res.writeHead(r.status, { "Content-Type": "application/json", ...r.headers });
    res.end(JSON.stringify(r.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api/v1`,
    calls,
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
