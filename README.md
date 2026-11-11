# CalcBloc MCP server: take-home pay, employer cost and official tax tables for AI assistants

`calcbloc-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that lets AI assistants work out take-home pay, employer cost and cross-country salary comparisons, and look up official income tax and social security tables, using [CalcBloc](https://calcbloc.com) data. It covers 24 countries, including the United States (all states), the United Kingdom, Canada, Australia, India, Germany, France, Spain and the Netherlands. Every answer states the tax year, links the official government sources behind the rates, and carries the credit "Data by CalcBloc".

> **Status:** version 0.1.0, not yet published to npm. Until it is, run it from source (see [Development](#development)). The `npx` commands below work once the package is on npm.

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Set up your AI client](#set-up-your-ai-client)
- [Tools](#tools)
- [Sample calls](#sample-calls)
- [Configuration](#configuration)
- [Limits and caching](#limits-and-caching)
- [Offline tax tables](#offline-tax-tables)
- [Development](#development)
- [Data, licence and credit](#data-licence-and-credit)

## What it does

Ask your assistant things like:

- "What is my take-home pay on $85,000 in California, filing single?"
- "How much does it cost a German employer to hire someone on €60,000?"
- "Compare £50,000 in Scotland with the same salary in Germany."
- "Show me the 2026 Ontario income tax brackets and where they come from."
- "What are the UK National Insurance thresholds for 2026-27?"

The server provides five read-only tools:

| Tool | What it returns |
| --- | --- |
| `calculate_take_home_pay` | Net pay after income tax and employee contributions, with a yearly, monthly and weekly breakdown |
| `calculate_employer_cost` | Salary plus employer social security, payroll taxes and other on-costs |
| `compare_countries` | The same salary in two countries, converted at the European Central Bank reference rate |
| `get_tax_tables` | Official tax tables (bands, allowances, contribution rates and thresholds) for a country, year and region |
| `list_countries` | Supported countries, tax years, regions and the options each calculation accepts |

Calculations run on CalcBloc's public API ([calcbloc.com/developers](https://calcbloc.com/developers)), the same engines and data as the calculators on calcbloc.com. Every result includes:

- the **tax year** the figures apply to;
- the **official source URLs** (government or statutory publications) for the rates used, with the date each was last checked;
- the **calcbloc.com page** for the result (calculator or tax-table page);
- the credit **"Data by CalcBloc"** and a short note that the figures are an estimate, not tax advice.

Tax tables are available for all 24 countries. Take-home pay calculations currently cover 12 of them (US, UK, Canada, Australia, New Zealand, Ireland, India, Germany, France, Spain, the Netherlands and Singapore); for the others the tools say so and link the country's tax tables. `list_countries` always shows the live list.

## Quick start

Requirements: [Node.js](https://nodejs.org) 20 or newer.

```bash
npx -y calcbloc-mcp
```

The server talks MCP over stdio, so you normally do not run it yourself: you add it to your AI client with the snippets below, and the client starts it when needed. No API key is required. A free key raises the daily limit (see [Limits and caching](#limits-and-caching)).

## Set up your AI client

All clients use the same command, `npx -y calcbloc-mcp`. The `CALCBLOC_API_KEY` entry is optional: leave it out, or paste your free key from [calcbloc.com/developers/keys](https://calcbloc.com/developers/keys).

### Claude Desktop

Open **Settings > Developer > Edit Config** and add the server to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`, Linux: `~/.config/Claude/`):

```json
{
  "mcpServers": {
    "calcbloc": {
      "command": "npx",
      "args": ["-y", "calcbloc-mcp"],
      "env": {
        "CALCBLOC_API_KEY": "your-free-key"
      }
    }
  }
}
```

Quit and restart Claude Desktop.

### Claude Code

```bash
claude mcp add --transport stdio calcbloc -- npx -y calcbloc-mcp
```

With an API key, available in all your projects:

```bash
claude mcp add --transport stdio --scope user --env CALCBLOC_API_KEY=your-free-key calcbloc -- npx -y calcbloc-mcp
```

To share it with a project, add it to `.mcp.json` at the project root and keep the key in your environment:

```json
{
  "mcpServers": {
    "calcbloc": {
      "command": "npx",
      "args": ["-y", "calcbloc-mcp"],
      "env": { "CALCBLOC_API_KEY": "${CALCBLOC_API_KEY:-}" }
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "calcbloc": {
      "command": "npx",
      "args": ["-y", "calcbloc-mcp"],
      "env": { "CALCBLOC_API_KEY": "your-free-key" }
    }
  }
}
```

### VS Code (GitHub Copilot)

Add to `.vscode/mcp.json`, or run **MCP: Add Server** from the Command Palette. VS Code asks for the key the first time and stores it securely:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "calcbloc-api-key",
      "description": "CalcBloc API key (optional, leave empty for anonymous use)",
      "password": true
    }
  ],
  "servers": {
    "calcbloc": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "calcbloc-mcp"],
      "env": { "CALCBLOC_API_KEY": "${input:calcbloc-api-key}" }
    }
  }
}
```

Or from a terminal, without a key:

```bash
code --add-mcp '{"name":"calcbloc","type":"stdio","command":"npx","args":["-y","calcbloc-mcp"]}'
```

### Windsurf and Devin

Devin Desktop and Devin CLI read `~/.config/devin/mcp_config.json` (Windows: `%APPDATA%\devin\mcp_config.json`) or `.devin/mcp_config.json` in a project. Windsurf uses the same `mcpServers` format in its MCP settings (raw config):

```json
{
  "mcpServers": {
    "calcbloc": {
      "command": "npx",
      "args": ["-y", "calcbloc-mcp"],
      "env": { "CALCBLOC_API_KEY": "your-free-key" }
    }
  }
}
```

### OpenAI Codex (CLI, IDE extension and app)

```bash
codex mcp add calcbloc -- npx -y calcbloc-mcp
```

or in `~/.codex/config.toml`:

```toml
[mcp_servers.calcbloc]
command = "npx"
args = ["-y", "calcbloc-mcp"]

[mcp_servers.calcbloc.env]
CALCBLOC_API_KEY = "your-free-key"
```

### Other MCP clients

Any client that can start a local (stdio) MCP server works: use the command `npx` with the arguments `-y calcbloc-mcp`, and optionally set `CALCBLOC_API_KEY` in its environment.

## Tools

All tools are read-only and idempotent, and declare an output schema; results come back as readable text plus `structuredContent` that matches the schema.

### `calculate_take_home_pay`

| Argument | Type | Notes |
| --- | --- | --- |
| `country` | string, required | Code or name: `us`, `uk`, `canada`, `india`, `germany`, "United Kingdom"... |
| `gross_salary` | number, required | Gross salary in the country's currency. Annual everywhere except Singapore (monthly). |
| `region` | string | Where the calculation varies by region: US state (`ca`), UK nation (`scotland`), Canadian province (`on`), Spanish community (`md`), German state (`by`), Indian state (`mh`). |
| `year` | string | Defaults to the current tax year (`2026` or `2026-27`). Earlier years are available as tax tables. |
| `options` | object | Country-specific options, e.g. US `{"filing_status": "married", "children": 2}`, UK `{"pension_pct": 5, "student_loan": "plan2"}`, Germany `{"tax_class": 3, "church": true}`. `list_countries` lists every option. |

Returns net annual pay, total deductions and effective rate where available, the engine's full results, a yearly/monthly/weekly breakdown, notes and the inputs used.

### `calculate_employer_cost`

Same arguments as `calculate_take_home_pay` (with employer options such as UK `pension_mode` or US `health_per_month`). Returns the total yearly and monthly cost, the cost multiplier where available, and a breakdown of employer contributions.

### `compare_countries`

| Argument | Type | Notes |
| --- | --- | --- |
| `country_a`, `country_b` | string, required | Two different countries with calculations. |
| `gross_salary` | number, required | Annual gross salary in `currency`. |
| `currency` | string | Country A's or country B's currency (ISO code). Default: country A's. |
| `region_a`, `region_b` | string | Region for the US, UK, Canada or India. |

Returns both sides (gross, income tax, contributions, take-home pay, effective rate, assumptions), the exchange rate and date, the difference, and a plain-English summary.

### `get_tax_tables`

| Argument | Type | Notes |
| --- | --- | --- |
| `country` | string, required | Any of the 24 countries. |
| `year` | string | Default: latest. Some countries also have the previous year (for example UK `2025-26`). |
| `region` | string | Regional table: US state, Canadian province, UK nation (Scotland, Wales), Swiss canton, Spanish community, Italian region, and others. |
| `group` | string | Only `income-tax`, `employee`, `employer` or `other` sections. |
| `sections` | string[] | Only these section ids. |

Returns each section's rows (bands with from/to/rate, or values with units), its basis, notes and official source, plus links to the tax-table page, the JSON API and a CSV download. Very long tables return a section index first, so the assistant can ask for the part it needs.

### `list_countries`

Without arguments, lists every country with its current tax year and which tools work for it. With `country`, also lists its regions and every calculation option, with allowed values and defaults.

## Sample calls

These are real responses from the server (recorded with the MCP SDK client over stdio; the figures come from the CalcBloc API on 11 November 2026). Long source lists are shortened.

**Take-home pay, £50,000 in Scotland**

```json
{ "name": "calculate_take_home_pay", "arguments": { "country": "uk", "gross_salary": 50000, "region": "scotland" } }
```

```text
Take-home pay in United Kingdom (Scotland), tax year 2026-27
Gross salary: GBP 50,000.00 (annual gross salary in GBP)
Take-home pay: GBP 38,024.07 a year
Effective deduction rate: 23.95%

Your pay in 2026/27 (Year | Month | Week, GBP):
- Gross salary: 50,000.00 | 4,166.67 | 961.54
- Income Tax: 8,982.05 | 748.50 | 172.73
- National Insurance: 2,993.88 | 249.49 | 57.57
- Take-home pay: 38,024.07 | 3,168.67 | 731.23
...
Calculator: https://calcbloc.com/uk/take-home-pay-calculator
Tax tables: https://calcbloc.com/uk/tax-tables/2026-27/scotland

Official sources:
- HMRC: Income Tax rates and allowances for current and previous tax years (updated 6 April 2026): https://www.gov.uk/government/publications/rates-and-allowances-income-tax/income-tax-rates-and-allowances-current-and-past (checked 2026-10-16)
- GOV.UK: Rates and thresholds for employers 2026 to 2027 (Class 1 National Insurance thresholds and rates): https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027 (checked 2026-10-16)
...

Estimate for information only, not tax, legal or financial advice. Figures follow the official sources listed; check them, or ask a qualified adviser, before making decisions.
Data by CalcBloc: https://calcbloc.com/uk/take-home-pay-calculator (licence CC BY 4.0, https://calcbloc.com/data)
```

The matching `structuredContent` (shortened):

```json
{
  "country": "uk",
  "countryName": "United Kingdom",
  "region": "scotland",
  "taxYear": "2026-27",
  "currency": "GBP",
  "grossSalary": 50000,
  "netAnnual": 38024.07,
  "effectiveRate": 0.2395186,
  "results": { "netMonthly": 3168.6725, "incomeTax": 8982.05, "employeeNi": 2993.88, "employerNi": 6749.4 },
  "taxTablesUrl": "https://calcbloc.com/uk/tax-tables/2026-27/scotland",
  "sources": [{ "title": "HMRC: Income Tax rates and allowances ...", "url": "https://www.gov.uk/government/publications/rates-and-allowances-income-tax/income-tax-rates-and-allowances-current-and-past", "retrievedAt": "2026-10-16" }],
  "calcblocUrl": "https://calcbloc.com/uk/take-home-pay-calculator",
  "attribution": "Data by CalcBloc",
  "licence": "CC BY 4.0",
  "disclaimer": "Estimate for information only, not tax, legal or financial advice. ..."
}
```

**Employer cost, €60,000 in Germany**

```json
{ "name": "calculate_employer_cost", "arguments": { "country": "germany", "gross_salary": 60000 } }
```

```text
Employer cost in Germany, tax year 2026
Gross salary: EUR 60,000.00 (annual gross salary in EUR (above the Midijob range))
Total cost to the employer: EUR 73,392.00 a year
Monthly cost: EUR 6,116.00

Employer cost of a €60,000 salary (Berlin) (Year | Month, EUR):
- Gross salary: 60,000.00 | 5,000.00
- Pension insurance (employer half): 5,580.00 | 465.00
- Unemployment insurance (employer half): 780.00 | 65.00
- Health insurance (employer half): 5,250.00 | 437.50
- Long-term care insurance (employer half): 1,080.00 | 90.00
- U1 sick-pay levy (0.8%): 480.00 | 40.00
- U2 maternity levy (0.22%): 132.00 | 11.00
- U3 insolvency levy (0.15%): 90.00 | 7.50
- Total employer cost: 73,392.00 | 6,116.00
...
Data by CalcBloc: https://calcbloc.com/germany/germany-employer-cost-calculator (licence CC BY 4.0, https://calcbloc.com/data)
```

**Compare the UK and Germany at £50,000**

```json
{ "name": "compare_countries", "arguments": { "country_a": "uk", "country_b": "germany", "gross_salary": 50000 } }
```

```text
Salary comparison: United Kingdom vs Germany, GBP 50,000.00 a year

England, United Kingdom (tax year 2026-27):
- Gross: GBP 50,000.00
- Income Tax: GBP 7,486.00
- National Insurance: GBP 2,993.88
- Take-home pay: GBP 39,520.12 (20.96% deducted)
...
Germany (tax year 2026):
- Gross: EUR 59,941.26
- Wage tax: EUR 9,372.00
...
- Take-home pay: EUR 37,532.10 (37.39% deducted)
...
Exchange rate: 1 GBP = 1.1988 EUR, rates as of 6 November 2026 (European Central Bank reference rates)
Comparison page: https://calcbloc.com/compare/salary
```

**Ontario income tax tables**

```json
{ "name": "get_tax_tables", "arguments": { "country": "canada", "region": "on", "group": "income-tax" } }
```

```text
Tax tables: Canada, Ontario, tax year 2026 (in force 2026-01-01 to 2026-12-31)
Currency: CAD. Status: verified.

### Ontario income tax brackets
(section: provincial-income-tax; group: income-tax; basis: Taxable income, per year)
- 0 to 53,891 at 5.05%
- 53,891 to 107,785 at 9.15%
- 107,785 to 150,000 at 11.16%
- 150,000 to 220,000 at 12.16%
- 220,000 and above at 13.16%
Source: T4127 Payroll Deductions Formulas, 122nd Edition, effective January 1, 2026 (CRA), ..., https://www.canada.ca/content/dam/cra-arc/formspubs/pub/t4127-jan/t4127-01-26e.pdf (checked 2026-10-25)
...
```

**A country without calculations yet**

```json
{ "name": "calculate_take_home_pay", "arguments": { "country": "austria", "gross_salary": 50000 } }
```

```text
Take-home pay calculation is not available for Austria yet. Its official 2026 tax tables are available: call get_tax_tables with country "austria", or see https://calcbloc.com/austria/tax-tables/2026.
```

## Configuration

All settings are optional environment variables, set in your client's `env` block:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CALCBLOC_API_KEY` | none | Free API key from [calcbloc.com/developers/keys](https://calcbloc.com/developers/keys), sent as the `X-API-Key` header. Raises the limit from 50 to 5,000 requests a day. |
| `CALCBLOC_DATA_DIR` | none | Folder with a copy of the [CalcBloc tax-table data](https://calcbloc.com/data). Tax tables are read from it first (see [Offline tax tables](#offline-tax-tables)). |
| `CALCBLOC_API_URL` | `https://calcbloc.com/api/v1` | API base URL (for testing). |
| `CALCBLOC_TIMEOUT_MS` | `20000` | Request timeout in milliseconds. |

## Limits and caching

The CalcBloc API is free. Without a key it allows 50 requests a day and 5 a minute per IP address; a free key allows 5,000 a day and 60 a minute. When a limit is reached, the tools say when to try again and how to get a key.

To save requests, the server keeps the country list and tax tables in memory for six hours. The first calculation for a country uses up to four requests (country list, calculation, and the national and regional tax tables that supply the official source links); later calculations for the same country use one. Tax-table lookups use one request per table, or none when a local data folder is set.

## Offline tax tables

The tax tables are also published as open data (JSON and CSV) at [calcbloc.com/data](https://calcbloc.com/data). If you keep a copy, point `CALCBLOC_DATA_DIR` at it (either the repository root or its `tables` folder, which contains `manifest.json`). `get_tax_tables` then reads from the folder without using the API, and keeps working when the API cannot be reached. Calculations always need the API.

The data is not bundled in the npm package: it is about 10 MB, and tables are updated when governments publish changes, so a bundled copy would go out of date between releases.

## Development

```bash
git clone https://github.com/itmarkerz/calcbloc-mcp.git
cd calcbloc-mcp
npm install
npm run build
npm test
```

- `npm test` builds the server and runs the unit tests (mocked HTTP) and an end-to-end test that starts `dist/index.js` over stdio with the MCP SDK client against a local mock of the API.
- `npm run inspector` opens the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) on the built server. From the command line:

  ```bash
  npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list
  npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/call --tool-name list_countries --tool-arg country=uk
  ```

- To use a local build in a client, replace `npx -y calcbloc-mcp` with `node /path/to/calcbloc-mcp/dist/index.js`.

Built with the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server` 2.4), which implements the 2026-07-28 MCP specification. Node.js 20 or newer.

## Data, licence and credit

- Tax data: [CalcBloc](https://calcbloc.com/data), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Credit: "Data by CalcBloc (calcbloc.com/data)". Each figure is taken from the official source named next to it, with the date it was last checked.
- Code: MIT licence, see [LICENSE](LICENSE).
- Results are estimates for information only and are not tax, legal or financial advice.

## Links

- Website: [calcbloc.com](https://calcbloc.com)
- API documentation: [calcbloc.com/developers](https://calcbloc.com/developers)
- Free API key: [calcbloc.com/developers/keys](https://calcbloc.com/developers/keys)
- Tax tables and downloads: [calcbloc.com/data](https://calcbloc.com/data)
- Issues: [github.com/itmarkerz/calcbloc-mcp/issues](https://github.com/itmarkerz/calcbloc-mcp/issues)
