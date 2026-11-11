import { McpServer } from "@modelcontextprotocol/server";
import { CalcBlocClient, type ClientOptions } from "./api.js";
import { SERVER_INSTRUCTIONS, SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { registerTools } from "./tools.js";

export { CalcBlocApiError, CalcBlocClient } from "./api.js";
export type { ClientOptions } from "./api.js";
export { ATTRIBUTION, DISCLAIMER } from "./constants.js";

/** Builds the CalcBloc MCP server (not yet connected to a transport). */
export function createServer(client: CalcBlocClient | ClientOptions = CalcBlocClient.fromEnv()): McpServer {
  const api = client instanceof CalcBlocClient ? client : new CalcBlocClient(client);
  const server = new McpServer(
    {
      name: SERVER_NAME,
      title: "CalcBloc tax and salary calculator",
      version: SERVER_VERSION,
      websiteUrl: "https://calcbloc.com/developers",
    },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerTools(server, api);
  return server;
}
