import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMockServer } from "./mock-api.js";

/**
 * End to end over stdio: spawns the built server (dist/index.js) with the SDK client, pointed at a local mock of the
 * CalcBloc API. Set TRANSCRIPT_DIR to save each request and response as JSON.
 */
const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const transcriptDir = process.env.TRANSCRIPT_DIR;

let mock: Awaited<ReturnType<typeof startMockServer>>;
let client: Client;

type CallResult = Awaited<ReturnType<Client["callTool"]>>;

function save(file: string, data: unknown) {
  if (!transcriptDir) return;
  mkdirSync(transcriptDir, { recursive: true });
  writeFileSync(join(transcriptDir, file), JSON.stringify(data, null, 2));
}

async function call(name: string, args: Record<string, unknown>): Promise<CallResult> {
  const result = await client.callTool({ name, arguments: args });
  const tag = Object.values(args)
    .filter((v) => typeof v !== "object")
    .join("-")
    .replace(/[^a-z0-9-]+/gi, "_");
  save(`${name}-${tag}.json`, { request: { method: "tools/call", params: { name, arguments: args } }, response: result });
  return result;
}

const textOf = (r: CallResult) => (r.content as { type: string; text: string }[]).map((c) => c.text).join("\n");

beforeAll(async () => {
  mock = await startMockServer();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { CALCBLOC_API_URL: mock.url, CALCBLOC_API_KEY: "cb_test_key", PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" },
    stderr: "pipe",
  });
  client = new Client({ name: "calcbloc-mcp-test", version: "1.0.0" });
  await client.connect(transport);
});

afterAll(async () => {
  await client?.close();
  await mock?.close();
});

describe("stdio server", () => {
  it("identifies itself and lists five read-only tools with input and output schemas", async () => {
    expect(client.getServerVersion()?.name).toBe("calcbloc-mcp");
    expect(client.getInstructions()).toContain("Data by CalcBloc");
    const { tools } = await client.listTools();
    save("tools-list.json", { request: { method: "tools/list" }, response: { tools } });
    expect(tools.map((t) => t.name)).toEqual(["calculate_take_home_pay", "calculate_employer_cost", "compare_countries", "get_tax_tables", "list_countries"]);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.outputSchema?.type).toBe("object");
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.description!.length).toBeGreaterThan(40);
    }
  });

  it("calculate_take_home_pay", async () => {
    const r = await call("calculate_take_home_pay", { country: "uk", gross_salary: 50000, region: "scotland" });
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent as Record<string, any>;
    expect(s).toMatchObject({ taxYear: "2026-27", netAnnual: 38024.07, attribution: "Data by CalcBloc" });
    expect(s.sources.length).toBeGreaterThan(0);
    expect(textOf(r)).toContain("Official sources:");
    expect(mock.calls.every((c) => c.apiKey === "cb_test_key")).toBe(true);
  });

  it("calculate_employer_cost", async () => {
    const r = await call("calculate_employer_cost", { country: "germany", gross_salary: 60000 });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ taxYear: "2026", totalCost: 73392, attribution: "Data by CalcBloc" });
  });

  it("compare_countries", async () => {
    const r = await call("compare_countries", { country_a: "uk", country_b: "germany", gross_salary: 50000 });
    expect(r.isError).toBeFalsy();
    expect((r.structuredContent as Record<string, any>).taxYear).toContain("2026-27");
  });

  it("get_tax_tables", async () => {
    const r = await call("get_tax_tables", { country: "uk", region: "scotland", group: "income-tax" });
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent as Record<string, any>;
    expect(s.region).toBe("scotland");
    expect(s.sources.every((x: { url: string }) => x.url.startsWith("https://"))).toBe(true);
  });

  it("list_countries", async () => {
    const r = await call("list_countries", { country: "canada" });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toContain("on (Ontario)");
  });

  it("returns a tool error (not a crash) for countries without calculations", async () => {
    const r = await call("calculate_take_home_pay", { country: "austria", gross_salary: 50000 });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("https://calcbloc.com/austria/tax-tables/2026");
  });

  it("rejects invalid arguments through schema validation", async () => {
    const r = await client.callTool({ name: "calculate_take_home_pay", arguments: { country: "uk", gross_salary: -5 } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/gross_salary/);
  });
});
