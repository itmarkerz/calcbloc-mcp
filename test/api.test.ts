import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CalcBlocApiError, CalcBlocClient, humanDuration } from "../src/api.js";
import { mockFetch } from "./mock-api.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

const fakeFetch = (fn: (url: URL, init?: RequestInit) => Promise<Response>) => fn as unknown as typeof fetch;

describe("CalcBlocClient", () => {
  it("uses the default API URL and a descriptive User-Agent", async () => {
    let seen: { url: string; headers: Headers } | undefined;
    const api = new CalcBlocClient({
      fetch: fakeFetch(async (url, init) => {
        seen = { url: String(url), headers: new Headers(init?.headers) };
        return new Response(JSON.stringify({ countries: [] }), { status: 200 });
      }),
    });
    await api.countries();
    expect(seen!.url).toBe("https://calcbloc.com/api/v1/countries");
    expect(seen!.headers.get("user-agent")).toMatch(/^calcbloc-mcp\//);
    expect(seen!.headers.get("x-api-key")).toBeNull();
  });

  it("reads configuration from the environment", () => {
    const api = CalcBlocClient.fromEnv({ CALCBLOC_API_URL: "http://localhost:9/api/v1/", CALCBLOC_API_KEY: " k " });
    expect(api.apiUrl).toBe("http://localhost:9/api/v1");
    expect(api.hasApiKey).toBe(true);
  });

  it("maps API errors, invalid keys, network failures and non-JSON replies", async () => {
    const reply = (status: number, body: unknown) =>
      new CalcBlocClient({ fetch: fakeFetch(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) });
    await expect(reply(400, { error: { code: "invalid_parameter", message: "Bad salary", docs: "https://calcbloc.com/developers#parameters" } }).netSalary({})).rejects.toMatchObject({
      code: "invalid_parameter",
      status: 400,
      message: "Bad salary",
    });
    await expect(reply(401, { error: { code: "invalid_key", message: "Unknown key." } }).netSalary({})).rejects.toThrow(/CALCBLOC_API_KEY/);
    await expect(reply(502, "<html>bad gateway</html>").netSalary({})).rejects.toThrow(/not JSON/);
    const down = new CalcBlocClient({
      fetch: fakeFetch(async () => {
        throw new TypeError("fetch failed");
      }),
    });
    await expect(down.countries()).rejects.toBeInstanceOf(CalcBlocApiError);
    await expect(down.countries()).rejects.toThrow(/Could not reach/);
  });

  it("explains rate limits for anonymous use and for API keys", async () => {
    const limited = (apiKey?: string) =>
      new CalcBlocClient({
        apiKey,
        fetch: fakeFetch(async () => new Response(JSON.stringify({ error: { code: "rate_limited", message: "Slow down" } }), { status: 429, headers: { "Retry-After": "48818" } })),
      });
    await expect(limited().countries()).rejects.toThrow(/50 requests a day.*CALCBLOC_API_KEY/s);
    await expect(limited().countries()).rejects.toThrow(/14 hours/);
    await expect(limited("k").countries()).rejects.toThrow(/5,000 requests a day/);
  });

  it("does not cache failures", async () => {
    let n = 0;
    const api = new CalcBlocClient({
      fetch: fakeFetch(async () => (++n === 1 ? new Response("{}", { status: 500 }) : new Response(JSON.stringify({ countries: [{ code: "uk" }] }), { status: 200 }))),
    });
    await expect(api.countries()).rejects.toThrow();
    await expect(api.countries()).resolves.toHaveLength(1);
  });

  it("reads tax tables from a local calcbloc-data folder before the API", async () => {
    const dir = mkdtempSync(join(tmpdir(), "calcbloc-data-"));
    const tables = join(dir, "tables");
    mkdirSync(join(tables, "uk", "2026-27"), { recursive: true });
    copyFileSync(join(fixtures, "table-uk-2026-27.json"), join(tables, "uk", "2026-27.json"));
    copyFileSync(join(fixtures, "table-uk-2026-27-scotland.json"), join(tables, "uk", "2026-27", "scotland.json"));
    writeFileSync(
      join(tables, "manifest.json"),
      JSON.stringify({ countries: [{ country: "uk", name: "United Kingdom", current_year: "2026-27", years: ["2026-27"], regions: [{ code: "scotland", name: "Scotland", slug: "scotland" }] }] }),
    );
    const m = mockFetch();
    const api = new CalcBlocClient({ dataDir: dir, fetch: m.fetch });
    const nat = await api.taxTable("uk", "latest");
    const sco = await api.taxTable("uk", "2026-27", "scotland");
    expect(nat.origin).toBe("local");
    expect(nat.table.year).toBe("2026-27");
    expect(sco.table.region?.code).toBe("scotland");
    expect(m.calls).toHaveLength(0);
    // Not in the folder: falls back to the API.
    const de = await api.taxTable("germany", "2026");
    expect(de.origin).toBe("api");
    expect(m.calls).toHaveLength(1);

    // API unreachable: the country list comes from the folder's manifest (tables only).
    const offline = new CalcBlocClient({
      dataDir: tables,
      fetch: fakeFetch(async () => {
        throw new TypeError("fetch failed");
      }),
    });
    const list = await offline.countries();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ code: "uk", tables_only: true, current_year: "2026-27" });
    expect(list[0]!.endpoints["tax-tables"].regions).toEqual([{ code: "scotland", name: "Scotland" }]);
  });

  it("formats retry times", () => {
    expect(humanDuration(30)).toBe("30 seconds");
    expect(humanDuration(600)).toBe("10 minutes");
    expect(humanDuration(48818)).toBe("14 hours");
  });
});
