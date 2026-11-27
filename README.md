# CalcBloc MCP server: take-home pay, employer cost and official tax tables for AI assistants

[![npm version](https://img.shields.io/npm/v/calcbloc-mcp)](https://www.npmjs.com/package/calcbloc-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-io.github.itmarkerz%2Fcalcbloc--mcp-blue)](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.itmarkerz/calcbloc-mcp)
[![License: MIT](https://img.shields.io/npm/l/calcbloc-mcp)](LICENSE)
[![itmarkerz/calcbloc-mcp MCP server](https://glama.ai/mcp/servers/itmarkerz/calcbloc-mcp/badges/score.svg)](https://glama.ai/mcp/servers/itmarkerz/calcbloc-mcp)

`calcbloc-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that lets AI assistants work out take-home pay, employer cost, cross-country salary comparisons, the tax withheld on a bonus and the tax on RSUs and stock options, and look up official income tax and social security tables and double taxation treaty rates, using [CalcBloc](https://calcbloc.com/?utm_source=calcbloc-mcp&utm_medium=readme&utm_campaign=itmarkerz-oss) data. It covers the United States (all states), the United Kingdom, Canada, Australia, India, Germany, France, Spain, the Netherlands and every other country listed under [Coverage](#coverage). Every answer states the tax year, links the official government sources behind the rates, and carries the credit "Data by CalcBloc".

CalcBloc is a product of [itmarkerz technologies](https://itmarkerz.co.in/?utm_source=calcbloc-mcp&utm_medium=readme&utm_campaign=itmarkerz-oss).

Install with `npx -y calcbloc-mcp` ([npm package](https://www.npmjs.com/package/calcbloc-mcp)). The server is listed in the official [MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.itmarkerz/calcbloc-mcp) as `io.github.itmarkerz/calcbloc-mcp`.

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
- "How much of my $20,000 bonus will be withheld in New York, and will I owe more at tax time?"
- "I exercise 1,000 EMI options worth £12 a share with an exercise price of £3: what tax do I pay?"
- "What is the maximum withholding tax on royalties paid from India to a UK company under the treaty?"

The server provides fourteen read-only tools:

| Tool | What it returns |
| --- | --- |
| `calculate_take_home_pay` | Net pay after income tax and employee contributions, with a yearly, monthly and weekly breakdown |
| `calculate_employer_cost` | Salary plus employer social security, payroll taxes and other on-costs |
| `compare_countries` | The same salary in two countries, converted at the European Central Bank reference rate |
| `calculate_supplemental_withholding` | Tax withheld on a bonus, commission, RSU vest, option exercise or lump sum, next to the final tax it adds |
| `calculate_equity_tax` | Tax on RSUs and stock options at vest or exercise and on sale, with flags and alternative scenarios |
| `calculate_cross_border_equity` | An RSU vest or option exercise split between the countries worked in, with each share's estimated tax |
| `calculate_import_duty` | Duties, import VAT, excise and landed cost of one import into the UK, the EU, the US or India |
| `get_tariff` | Tariff lines of a commodity code: duty rates, preferences, quotas and extra duties |
| `list_trade_agreements` | Trade agreements and preference schemes in a tariff, with rules of origin and official links |
| `get_tax_tables` | Official tax tables (bands, allowances, contribution rates and thresholds) for a country, year and region |
| `search_tax_facts` | Tax-table figures as facts, filtered by country, tax type, jurisdiction, level and year |
| `get_tax_calendar` | Tax year in force, next tax year, enacted and announced changes and the next budget |
| `get_tax_treaties` | Double taxation treaty withholding limits (dividends, interest, royalties, technical fees), relief method, dates and MLI status |
| `list_countries` | Supported countries, tax years, regions and the options each calculation accepts |

Calculations run on CalcBloc's public API ([calcbloc.com/developers](https://calcbloc.com/developers?utm_source=calcbloc-mcp&utm_medium=readme&utm_campaign=itmarkerz-oss)), the same engines and data as the calculators on calcbloc.com. Every result includes:

- the **tax year** the figures apply to;
- the **official source URLs** (government or statutory publications) for the rates used, with the date each was last checked;
- the **calcbloc.com page** for the result (calculator or tax-table page);
- the credit **"Data by CalcBloc"** and a short note that the figures are an estimate, not tax advice.

### Coverage

<!-- coverage:start -->
<!-- Generated by scripts/gen-coverage.mjs from GET /api/v1/countries. Do not edit by hand. -->
217 countries with official tax tables; 15 with take-home pay calculations; 14 with employer cost; 15 in the cross-country comparison (France: take-home pay and compare only, no employer cost yet); 12 with supplemental (bonus) withholding; 5 with equity compensation tax (RSUs and stock options); 10 with cross-border equity estimates for mobile employees.

- **Take-home pay** (`calculate_take_home_pay`): `ee`, `pl`, `dk`, `sg`, `fr`, `nl`, `es`, `de`, `us`, `uk`, `au`, `nz`, `ca`, `ie`, `in`.
- **Employer cost** (`calculate_employer_cost`): `ee`, `pl`, `dk`, `sg`, `nl`, `es`, `de`, `us`, `uk`, `au`, `nz`, `ca`, `ie`, `in`.
- **Compare** (`compare_countries`): `ee`, `pl`, `dk`, `sg`, `fr`, `nl`, `es`, `de`, `us`, `uk`, `au`, `nz`, `ca`, `ie`, `in`.
- **Supplemental withholding** (`calculate_supplemental_withholding`: tax withheld on a bonus, commission, RSU vest, option exercise or lump sum, next to the final tax it adds): `sg`, `fr`, `nl`, `es`, `de`, `us`, `uk`, `au`, `nz`, `ca`, `ie`, `in`.
- **Equity tax** (`calculate_equity_tax`: RSUs and stock options at vest or exercise, and on sale): `us` (rsu, nso, iso), `uk` (rsu, emi, csop, unapproved_option), `au` (ess_upfront, ess_deferred, rsu), `ca` (stock_option), `in` (esop, rsu).
- **Cross-border equity** (`calculate_cross_border_equity`: an RSU vest or option exercise split between the countries worked in from grant to vest, with each share's estimated tax): tax estimates for `sg`, `nl`, `es`, `de`, `us`, `uk`, `au`, `ca`, `ie`, `in`; the split itself works for every country.
- **Tax tables** (`get_tax_tables`) and **tax facts** (`search_tax_facts`): all 217 countries; the others say so and link their tax tables when a calculation is asked for.
- **Tax calendar** (`get_tax_calendar`: tax year, next tax year, enacted and announced changes, next budget): all 217 countries.
- **Import duty, tariffs and trade agreements** (`calculate_import_duty`, `get_tariff`, `list_trade_agreements`): imports into the UK, the EU (any member state), the United States and India, as the API's tariff data allows.
- **Tax treaties** (`get_tax_treaties`: withholding limits on dividends, interest, royalties and technical fees, relief method, dates and MLI status): the double taxation treaties the API stores (India's with the United States, Singapore, the United Kingdom, Japan, Australia and Austria in API 1.10).
- **`region` is required** for take-home pay in `us`, `ca`; for employer cost in `us`, `au`, `ca`; for supplemental withholding in `us`, `ca`; for equity tax in `ca`. A missing or unknown region returns the valid codes and names.
- Not yet supported: cross-border salary withholding (multi-country payroll), and the double-tax relief amount (get_tax_treaties lists the treaty withholding limits CalcBloc stores).

`list_countries` always shows the live list.
<!-- coverage:end -->

## Quick start

Requirements: [Node.js](https://nodejs.org) 20 or newer.

```bash
npx -y calcbloc-mcp
```

The server talks MCP over stdio, so you normally do not run it yourself: you add it to your AI client with the snippets below, and the client starts it when needed. No API key is required. A free key raises the daily limit (see [Limits and caching](#limits-and-caching)).

### Remote server (no install)

The same tools are also hosted at **`https://calcbloc.com/mcp`** (Streamable HTTP, no sign-in). Use it in clients that connect to MCP servers by URL, such as custom connectors on claude.ai or Claude Desktop (**Settings > Connectors > Add custom connector**), or in Claude Code:

```bash
claude mcp add --transport http calcbloc https://calcbloc.com/mcp
```

Without a key, each address gets 500 tool API calls a day (30 a minute) within a shared daily total. To use your own free key (5,000 a day), send it as the `X-API-Key` header, for example `claude mcp add --transport http calcbloc https://calcbloc.com/mcp --header "X-API-Key: your-free-key"`, or as `Authorization: Bearer your-free-key`.

## Set up your AI client

All clients use the same command, `npx -y calcbloc-mcp`. The `CALCBLOC_API_KEY` entry is optional: leave it out, or paste your free key from [calcbloc.com/developers/keys](https://calcbloc.com/developers/keys?utm_source=calcbloc-mcp&utm_medium=readme&utm_campaign=itmarkerz-oss).

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
| `country` | string, required | Short code (ISO 3166-1 alpha-2 in lower case; the UK is `uk`, `gb` also works): `us`, `uk`, `ca`, `in`, `de`, `nz`, or the name ("United Kingdom"). Older keys such as `new-zealand` still work. |
| `gross_salary` | number, required | Gross salary in the country's currency. Annual everywhere except Singapore (monthly). |
| `region` | string | Code or name, where the calculation varies by region: US state (`ca` or "California"), UK nation (`scotland`), Canadian province (`on`), Spanish community (`md`), German state (`by`), Indian state (`mh`). **Required** for the countries listed under [Coverage](#coverage); a missing or unknown region returns the valid codes. |
| `year` | string | Defaults to the current tax year (`2026` or `2026-27`). Earlier years are available as tax tables. |
| `options` | object | Country-specific options, e.g. US `{"filing_status": "mfj", "children": 2}` (`single`, `mfj` or `hoh`; `married` and `head_of_household` are accepted too), UK `{"pension_pct": 5, "student_loan": "plan2"}`, Germany `{"tax_class": 3, "church": true}`. `list_countries` lists every option with its allowed values and default. |

Returns net annual pay, total deductions and effective rate where available, the engine's full results, a yearly/monthly/weekly breakdown, notes and the inputs used. For countries on CalcBloc's shared take-home engine (Denmark, Estonia, Poland), it also shows how the calculation was verified: "checked against an official worked example" or "computed from the law text; no official example is published", with the official URLs (`verification` in the structured result; null for the other countries).

### `calculate_employer_cost`

Same arguments as `calculate_take_home_pay` (with employer options such as UK `pension_mode`, US `health_per_month` or Poland `accident_rate_pct`). Returns the total yearly and monthly cost, the cost multiplier where available, a breakdown of employer contributions and, where the API gives one, the same verification marker.

### `compare_countries`

| Argument | Type | Notes |
| --- | --- | --- |
| `country_a`, `country_b` | string, required | Two different countries with calculations. |
| `gross_salary` | number, required | Annual gross salary in `currency`. |
| `currency` | string | Country A's or country B's currency (ISO code). Default: country A's. |
| `region_a`, `region_b` | string | Region for the US, UK, Canada or India. |

Returns both sides (gross, income tax, contributions, take-home pay, effective rate, assumptions), the exchange rate and date, the difference, and a plain-English summary.

### `calculate_supplemental_withholding`

Tax withheld on a bonus, commission, RSU vest, stock option exercise or lump sum paid on top of a regular salary, with the official withholding method (for example the IRS supplemental flat rate and the mandatory rate over $1 million, HMRC cumulative PAYE, the CRA bonus method), next to the final tax the payment adds at the person's real rates.

| Argument | Type | Notes |
| --- | --- | --- |
| `country` | string, required | A country listed under [Coverage](#coverage) for supplemental withholding. Other countries return the list of supported ones. |
| `gross_salary` | number, required | Regular gross salary for the year, before the payment, in the country's currency (annual everywhere). |
| `amount` | number, required | The supplemental payment (gross). |
| `type` | string | `bonus` (default), `commission`, `rsu_vest`, `option_exercise` or `lump_sum`. A few countries take fewer types (Australia: `bonus`, `commission`, `lump_sum`; Ireland: no `option_exercise`); another type returns the country's list. |
| `region` | string | Code or name. **Required** for the US (state) and Canada (province); optional where it changes the result (UK nation, German state, Spanish community). |
| `options` | object | Country-specific options, e.g. US `{"filing_status": "mfj", "method": "aggregate", "ytd_supplemental": 900000}`, UK `{"tax_code_number": 1257, "month_paid": 12}`, Germany `{"tax_class": 3, "church": true}`. `list_countries` lists every option with its allowed values and default. |

Returns the method, each line's withholding and the final tax it adds (with its official source), the totals, the difference (positive: more due after the year; negative: refund), the net payment, notes and the inputs used.

### `calculate_equity_tax`

Tax on RSUs and stock options: income tax, social security and employer withholding at vest or exercise, and capital gains tax on a later sale, with flags (such as AMT exposure) and alternative outcomes (such as qualifying vs disqualifying disposition).

| Argument | Type | Notes |
| --- | --- | --- |
| `country` | string, required | A country listed under [Coverage](#coverage) for equity tax. Other countries return the list of supported ones. |
| `instrument` | string, required | Per country: US `rsu`, `nso`, `iso`; UK `rsu`, `emi`, `csop`, `unapproved_option`; Canada `stock_option`; Australia `ess_upfront`, `ess_deferred`, `rsu`; India `esop`, `rsu`. Another country's instrument returns this country's list. |
| `units` | number, required | Shares vesting or options exercised. |
| `grant_date`, `event_date` | string, required | `YYYY-MM-DD`. The event is the vest (RSUs), the exercise (options) or the taxing point (Australia ESS). |
| `fmv_event` | number, required | Market value per share at vest or exercise. |
| `gross_salary` | number, required | Regular annual gross salary (for the marginal rates and contribution ceilings). |
| `exercise_price` | number | Per share; required for options. |
| `fmv_grant` | number | Market value per share at grant (UK EMI discount and CSOP limit, Canada stock option deduction). |
| `sale_price`, `sale_date` | number, string | Together: adds the tax on the sale. |
| `region` | string | **Required** for Canada (province); optional for the US (state withholding) and the UK (Scotland, Wales). |
| `options` | object | Country-specific options, e.g. US `{"filing_status": "mfj"}`, UK `{"readily_convertible": false}`, Canada `{"employer_type": "ccpc"}`, India `{"regime": "old"}`. `list_countries` lists them. |

Returns the taxable amount at the event, each line (stage, base, amount, rate, amount withheld, note, official source), the totals at the event and at sale, flags, scenarios, notes and the inputs used.

### `get_tax_tables`

| Argument | Type | Notes |
| --- | --- | --- |
| `country` | string, required | Any listed country (every one has tax tables). |
| `year` | string | Default: latest. Some countries also have the previous year (for example UK `2025-26`). |
| `region` | string | Regional table: US state, Canadian province, UK nation (Scotland, Wales), Swiss canton, Spanish community, Italian region, and others. |
| `group` | string | Only `income-tax`, `employee`, `employer` or `other` sections. |
| `sections` | string[] | Only these section ids. |

Returns each section's rows (bands with from/to/rate, or values with units), its basis, notes and official source, plus links to the tax-table page, the JSON API and a CSV download. Very long tables return a section index first, so the assistant can ask for the part it needs.

### `get_tax_treaties`

The double taxation treaties CalcBloc stores for a country (API 1.10: India's treaties with the United States, Singapore, the United Kingdom, Japan, Australia and Austria), each read from an official copy.

| Argument | Type | Notes |
| --- | --- | --- |
| `country` | string, required | Short code or English name, e.g. `in` or "India". A country without stored treaties returns the countries that have them. |
| `partner` | string | Only the treaty with this country: ISO code or name (`us`, `uk` or `gb`, "Singapore"). With one treaty, the answer quotes each article's wording. |

Returns, for each treaty, the maximum withholding tax the source country may charge on dividends (and the lower rate for a qualifying shareholding), interest, royalties and fees for technical services, each with its condition, article and wording. It also gives each country's relief method (credit or exemption), the signature and entry-into-force dates, whether the MLI modifies the treaty, and the official source. Nothing is computed: a lower domestic rate, beneficial ownership, the MLI principal purpose test and anti-abuse rules still apply.

### `list_countries`

Without arguments, lists every country with its current tax year and which tools work for it. With `country`, also lists its regions and every calculation option, with allowed values and defaults, including the payment types, instruments and options of supplemental withholding and equity tax.

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
| `CALCBLOC_API_KEY` | none | Optional; raises the keyless allowance. Free API key (email only) from [calcbloc.com/developers/keys](https://calcbloc.com/developers/keys?utm_source=calcbloc-mcp&utm_medium=readme&utm_campaign=itmarkerz-oss), sent as the `X-API-Key` header on every request. |
| `CALCBLOC_DATA_DIR` | none | Folder with a copy of the [CalcBloc tax-table data](https://calcbloc.com/data?utm_source=calcbloc-mcp&utm_medium=readme&utm_campaign=itmarkerz-oss). Tax tables are read from it first (see [Offline tax tables](#offline-tax-tables)). |
| `CALCBLOC_API_URL` | `https://calcbloc.com/api/v1` | API base URL (for testing). |
| `CALCBLOC_TIMEOUT_MS` | `20000` | Request timeout in milliseconds. |
| `CLAUDE_PLUGIN_OPTION_CALCBLOC_API_KEY` | none | The same API key under the name the CalcBloc Claude plugin passes it ([`plugin/`](plugin/)). `CALCBLOC_API_KEY` wins when both are set. Empty values and unfilled placeholders such as `${user_config.calcbloc_api_key}` count as no key. |

## Limits and caching

The CalcBloc API is free. Without a key it allows a smaller number of requests a day and a minute per IP address than with a free key; the current numbers are on [calcbloc.com/developers](https://calcbloc.com/developers?utm_source=calcbloc-mcp&utm_medium=readme&utm_campaign=itmarkerz-oss#limits), and every API response reports the daily limit in `X-RateLimit-Limit`. When the keyless allowance runs out (the API answers 429, or reports `X-RateLimit-Remaining: 0`), the tool error says the free allowance without a key is used up and continues **"Get a free API key (email only)"**: it links to [calcbloc.com/developers/keys](https://calcbloc.com/developers/keys?utm_source=calcbloc-mcp&utm_medium=readme&utm_campaign=itmarkerz-oss) and says to set it as `CALCBLOC_API_KEY` in this server's `env` block and restart. Until the limit resets the server sends no more requests (each tool call answers with the same message at once); offline tax tables from `CALCBLOC_DATA_DIR` keep working. With a key, a limit message gives the key's limits and when to try again.

To save requests, the server keeps the country list and tax tables in memory for six hours. The first calculation for a country uses up to four requests (country list, calculation, and the national and regional tax tables that supply the official source links); later calculations for the same country use one. Tax-table lookups use one request per table, or none when a local data folder is set.

## Offline tax tables

The tax tables are also published as open data (JSON and CSV) at [calcbloc.com/data](https://calcbloc.com/data?utm_source=calcbloc-mcp&utm_medium=readme&utm_campaign=itmarkerz-oss). If you keep a copy, point `CALCBLOC_DATA_DIR` at it (either the repository root or its `tables` folder, which contains `manifest.json`). `get_tax_tables` then reads from the folder without using the API, and keeps working when the API cannot be reached. Calculations always need the API.

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

- Tax data: [CalcBloc](https://calcbloc.com/data?utm_source=calcbloc-mcp&utm_medium=readme&utm_campaign=itmarkerz-oss), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Credit: "Data by CalcBloc (calcbloc.com/data)". Each figure is taken from the official source named next to it, with the date it was last checked.
- Code: MIT licence, see [LICENSE](LICENSE).
- Results are estimates for information only and are not tax, legal or financial advice.

## Links

- Website: [calcbloc.com](https://calcbloc.com/?utm_source=calcbloc-mcp&utm_medium=readme&utm_campaign=itmarkerz-oss)
- API documentation: [calcbloc.com/developers](https://calcbloc.com/developers?utm_source=calcbloc-mcp&utm_medium=readme&utm_campaign=itmarkerz-oss)
- Free API key: [calcbloc.com/developers/keys](https://calcbloc.com/developers/keys?utm_source=calcbloc-mcp&utm_medium=readme&utm_campaign=itmarkerz-oss)
- Tax tables and downloads: [calcbloc.com/data](https://calcbloc.com/data?utm_source=calcbloc-mcp&utm_medium=readme&utm_campaign=itmarkerz-oss)
- Issues: [github.com/itmarkerz/calcbloc-mcp/issues](https://github.com/itmarkerz/calcbloc-mcp/issues)

## About

[CalcBloc](https://calcbloc.com/?utm_source=calcbloc-mcp&utm_medium=readme&utm_campaign=itmarkerz-oss) is built and maintained by [itmarkerz technologies](https://itmarkerz.co.in/?utm_source=calcbloc-mcp&utm_medium=readme&utm_campaign=itmarkerz-oss), a web and mobile app development company in Kerala, India. The data behind this server is at [calcbloc.com/data](https://calcbloc.com/data?utm_source=calcbloc-mcp&utm_medium=readme&utm_campaign=itmarkerz-oss) and the API documentation at [calcbloc.com/developers](https://calcbloc.com/developers?utm_source=calcbloc-mcp&utm_medium=readme&utm_campaign=itmarkerz-oss). The other CalcBloc packages (Python, JavaScript, PHP, R, Google Sheets and the dataset itself) are in the [itmarkerz GitHub organization](https://github.com/itmarkerz).
