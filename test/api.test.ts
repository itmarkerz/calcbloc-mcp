import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { apiKeyFromEnv, CalcBlocApiError, CalcBlocClient, humanDuration } from "../src/api.js";
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

  it("reads the API key from CALCBLOC_API_KEY or the Claude plugin option, ignoring empty values and placeholders", () => {
    expect(apiKeyFromEnv({ CALCBLOC_API_KEY: " k1 " })).toBe("k1");
    expect(apiKeyFromEnv({ CLAUDE_PLUGIN_OPTION_CALCBLOC_API_KEY: "k2" })).toBe("k2");
    expect(apiKeyFromEnv({ CALCBLOC_API_KEY: "k1", CLAUDE_PLUGIN_OPTION_CALCBLOC_API_KEY: "k2" })).toBe("k1");
    expect(apiKeyFromEnv({ CALCBLOC_API_KEY: "", CLAUDE_PLUGIN_OPTION_CALCBLOC_API_KEY: "k2" })).toBe("k2");
    expect(apiKeyFromEnv({ CLAUDE_PLUGIN_OPTION_CALCBLOC_API_KEY: "${user_config.calcbloc_api_key}" })).toBeUndefined();
    expect(apiKeyFromEnv({ CLAUDE_PLUGIN_OPTION_CALCBLOC_API_KEY: "  " })).toBeUndefined();
    expect(apiKeyFromEnv({})).toBeUndefined();
    expect(CalcBlocClient.fromEnv({ CLAUDE_PLUGIN_OPTION_CALCBLOC_API_KEY: "" }).hasApiKey).toBe(false);
    expect(CalcBlocClient.fromEnv({ CLAUDE_PLUGIN_OPTION_CALCBLOC_API_KEY: "k2" }).hasApiKey).toBe(true);
  });

  it("trims any number of trailing slashes from the API URL", () => {
    expect(new CalcBlocClient({ apiUrl: "https://calcbloc.test/api/v1///" }).apiUrl).toBe("https://calcbloc.test/api/v1");
    expect(new CalcBlocClient({ apiUrl: "https://calcbloc.test/api/v1" }).apiUrl).toBe("https://calcbloc.test/api/v1");
    expect(new CalcBlocClient({ apiUrl: "/".repeat(100_000) + "x" }).apiUrl).toBe("/".repeat(100_000) + "x");
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
    const err = (await limited().countries().catch((e: unknown) => e)) as CalcBlocApiError;
    expect(err.message).toMatch(/Add your free API key/);
    expect(err.message).toContain("https://calcbloc.com/developers/keys?utm_source=calcbloc-mcp&utm_medium=app&utm_campaign=itmarkerz-oss");
    expect(err.message).toMatch(/CALCBLOC_API_KEY environment variable/);
    const keyed = (await limited("k").countries().catch((e: unknown) => e)) as CalcBlocApiError;
    expect(keyed.message).not.toMatch(/Add your free API key/);
  });

  it("works without a key, and sends the key on every request once set", async () => {
    const seen: (string | null)[] = [];
    const make = (apiKey?: string) =>
      new CalcBlocClient({
        apiKey,
        fetch: fakeFetch(async (_url, init) => {
          seen.push(new Headers(init?.headers).get("x-api-key"));
          return new Response(JSON.stringify({ countries: [] }), { status: 200, headers: { "X-RateLimit-Remaining": "40" } });
        }),
      });
    await make().countries();
    await make("cb_key").countries();
    await make("cb_key").netSalary({ country: "uk", salary: 1 });
    expect(seen).toEqual([null, "cb_key", "cb_key"]);
  });

  it("after a 429 makes no further requests until Retry-After has passed (no retry storm)", async () => {
    let t = 0;
    let calls = 0;
    const api = new CalcBlocClient({
      now: () => t,
      fetch: fakeFetch(async () => {
        calls++;
        return calls === 1
          ? new Response(JSON.stringify({ error: { code: "rate_limited", message: "Too many requests this minute (limit 5)." } }), { status: 429, headers: { "Retry-After": "30" } })
          : new Response(JSON.stringify({ country: "uk" }), { status: 200 });
      }),
    });
    await expect(api.netSalary({ country: "uk", salary: 1 })).rejects.toMatchObject({ code: "rate_limited", status: 429 });
    await expect(api.netSalary({ country: "uk", salary: 2 })).rejects.toThrow(/^The free allowance without a key \(5 requests a minute, 50 a day\) is used up for this minute\. Try again in about \d+ seconds\. Add your free API key/);
    await expect(api.employerCost({ country: "uk", salary: 2 })).rejects.toThrow(/Try again in about/);
    expect(calls).toBe(1);
    t += 31_000;
    await expect(api.netSalary({ country: "uk", salary: 3 })).resolves.toMatchObject({ country: "uk" });
    expect(calls).toBe(2);
  });

  it("asks for a key once a request without one reports X-RateLimit-Remaining: 0, without sending more", async () => {
    let calls = 0;
    const api = new CalcBlocClient({
      now: () => 0,
      fetch: fakeFetch(async () => {
        calls++;
        return new Response(JSON.stringify({ country: "uk" }), { status: 200, headers: { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "7200" } });
      }),
    });
    await expect(api.netSalary({ country: "uk", salary: 1 })).resolves.toMatchObject({ country: "uk" });
    await expect(api.netSalary({ country: "uk", salary: 2 })).rejects.toThrow(/^The free allowance of 50 requests a day without a key is used up\. Add your free API key \(5,000 requests a day\): .*CALCBLOC_API_KEY.* Without a key, try again in about 2 hours\.$/s);
    expect(calls).toBe(1);
    const keyed = new CalcBlocClient({
      apiKey: "cb_key",
      fetch: fakeFetch(async () => new Response(JSON.stringify({ country: "uk" }), { status: 200, headers: { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "7200" } })),
    });
    await keyed.netSalary({ country: "uk", salary: 1 });
    await expect(keyed.netSalary({ country: "uk", salary: 2 })).resolves.toMatchObject({ country: "uk" });
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
