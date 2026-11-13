# Directory listings

Ready-to-submit text and files for MCP directories. `calcbloc-mcp` has been on npm and in the official MCP Registry since 13 November 2026, so the listings below can be submitted now; see [PUBLISHING_CHECKLIST.md](../PUBLISHING_CHECKLIST.md) for the order.

| Directory | Status | What to submit | File |
| --- | --- | --- | --- |
| Official MCP Registry (registry.modelcontextprotocol.io) | Listed (0.1.0, 13 Nov 2026) | `server.json` at the repository root, published with `mcp-publisher` | [mcp-registry/README.md](mcp-registry/README.md) |
| Glama (glama.ai/mcp/servers) | Listed; to claim | Claim it with `glama.json` (now at the repository root) | [glama/](glama/) |
| PulseMCP (pulsemcp.com) | To check, then submit | Submission form text | [pulsemcp/listing.md](pulsemcp/listing.md) |
| mcp.so | To submit | Submission form text | [mcp-so/listing.md](mcp-so/listing.md) |
| Claude directory (claude.ai/directory) | To submit | Plugin bundle from the [`plugin/`](../plugin/) folder, submitted at claude.ai/directory/manage (paid Claude plan) | [../plugin/README.md](../plugin/README.md) |
| Smithery (smithery.ai) | No submissions | Directory only since 31 October 2026; see note | [smithery/README.md](smithery/README.md) |
| awesome-mcp-servers (GitHub) | To submit | One line in a pull request | [awesome-mcp-servers/entry.md](awesome-mcp-servers/entry.md) |

## Shared listing text

**Name:** CalcBloc

**Short description (100 characters max):** Take-home pay, employer cost and official tax tables for 41 countries, with sources.

**Description:**

CalcBloc's MCP server gives AI assistants accurate payroll and income tax answers. It calculates take-home pay and employer cost for 12 countries (US with every state, UK, Canada, Australia, New Zealand, Ireland, India, Germany, France, Spain, the Netherlands and Singapore), compares the same salary in two countries at the ECB reference rate, and returns official tax tables (income tax bands, allowances, social security rates and thresholds) for 41 countries. Every answer states the tax year, links the official government sources behind the rates and carries the credit "Data by CalcBloc". Free to use; no API key required to start, with an optional free key that is needed after 50 requests a day.

**Tools:** `calculate_take_home_pay`, `calculate_employer_cost`, `compare_countries`, `get_tax_tables`, `list_countries`

**Category / tags:** Finance, Tax, Payroll, HR, Salary, Data

**Install:** `npx -y calcbloc-mcp`

**Transport:** stdio (local). **Language:** TypeScript. **Licence:** MIT (code), CC BY 4.0 (data).

**Links:** repository https://github.com/itmarkerz/calcbloc-mcp, npm https://www.npmjs.com/package/calcbloc-mcp, website https://calcbloc.com/?utm_source=calcbloc-mcp&utm_medium=listing&utm_campaign=itmarkerz-oss, API docs https://calcbloc.com/developers?utm_source=calcbloc-mcp&utm_medium=listing&utm_campaign=itmarkerz-oss, data https://calcbloc.com/data?utm_source=calcbloc-mcp&utm_medium=listing&utm_campaign=itmarkerz-oss

**Environment variables (all optional):** `CALCBLOC_API_KEY` (needed after 50 requests a day; free key from https://calcbloc.com/developers/keys?utm_source=calcbloc-mcp&utm_medium=listing&utm_campaign=itmarkerz-oss), `CALCBLOC_DATA_DIR` (offline tax tables).

**Example prompts:**

- What is my take-home pay on $85,000 in California, filing single?
- How much does it cost a German employer to hire someone on EUR 60,000?
- Compare GBP 50,000 in Scotland with the same salary in Germany.
- Show me the 2026 Ontario income tax brackets and their official source.
