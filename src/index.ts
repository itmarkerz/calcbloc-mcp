#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { createServer } from "./server.js";

const arg = process.argv[2];
if (arg === "--version" || arg === "-v") {
  console.log(SERVER_VERSION);
  process.exit(0);
}
if (arg === "--help" || arg === "-h") {
  console.log(`${SERVER_NAME} ${SERVER_VERSION}
MCP server (stdio) for CalcBloc take-home pay, employer cost, salary comparison and official tax tables.

Usage: npx -y calcbloc-mcp

Environment (all optional):
  CALCBLOC_API_KEY     free API key from https://calcbloc.com/developers/keys (5,000 requests a day instead of 50)
  CALCBLOC_DATA_DIR    folder with the calcbloc-data tables; tax tables are read from it before the API
  CALCBLOC_API_URL     API base URL (default https://calcbloc.com/api/v1)
  CALCBLOC_TIMEOUT_MS  request timeout in milliseconds (default 20000)`);
  process.exit(0);
}

const server = createServer();
await server.connect(new StdioServerTransport());
// stdout carries the protocol; diagnostics go to stderr.
console.error(`${SERVER_NAME} ${SERVER_VERSION} running on stdio`);
