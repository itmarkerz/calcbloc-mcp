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
  }
  if (path === "/employer-cost" && q.get("country") === "germany") return { status: 200, body: fixture("employer-cost-germany.json") };
  if (path === "/compare" && q.get("a") === "uk" && q.get("b") === "germany") return { status: 200, body: fixture("compare-uk-germany.json") };
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
