# CalcBloc plugin: take-home pay, employer cost and official tax tables

CalcBloc gives Claude sourced answers to payroll and income tax questions. Ask what you would take home on a salary, what an employee costs an employer, how the same salary compares between two countries, or what the income tax bands, allowances and social security rates are. It covers take-home pay and employer cost for 12 countries (the United States with every state, the United Kingdom, Canada, Australia, New Zealand, Ireland, India, Germany, France, Spain, the Netherlands and Singapore) and official tax tables for 37 countries. Every answer states the tax year and links the official government sources behind the rates.

CalcBloc is a product of [itmarkerz technologies](https://itmarkerz.co.in).

## What you can ask

- "What is my take-home pay on $85,000 in California, filing single?"
- "How much does it cost a German employer to hire someone on €60,000?"
- "Compare £50,000 in Scotland with the same salary in Germany."
- "Show me the 2026 Ontario income tax brackets and where they come from."

## What the plugin contains

- **An MCP server.** The plugin starts the open-source [calcbloc-mcp](https://github.com/itmarkerz/calcbloc-mcp) server (MIT) on your computer with `npx -y calcbloc-mcp@0.1.2`, the exact version published on [npm](https://www.npmjs.com/package/calcbloc-mcp) with provenance. npx downloads it from the npm registry (`https://registry.npmjs.org`) the first time, together with its dependencies, the MCP TypeScript SDK (`@modelcontextprotocol/server`) and `zod`. The server has five read-only tools: `calculate_take_home_pay`, `calculate_employer_cost`, `compare_countries`, `get_tax_tables` and `list_countries`. It needs Node.js 20 or newer on your computer.
- **A skill, `salary-and-tax-answers`,** that tells Claude which tool to use, which details to ask for (country, salary, region), and to state the tax year and sources in its answer.

## What it sends and where

The first time the server starts, npx downloads the packages listed above from the npm registry. After that, the server sends each calculation's inputs to the CalcBloc API at `https://calcbloc.com/api/v1` over HTTPS: the country, the tax year, the region, the salary amount and the options you mention (such as filing status or pension contributions). Nothing else is sent. It does not read your files, your conversation or your Claude account.

- **API key:** optional. Without one you get 50 requests a day. A free key from [calcbloc.com/developers/keys](https://calcbloc.com/developers/keys) raises this to 5,000; enter it in the plugin's settings, where it is stored in your system's secure credential store and sent only to the CalcBloc API in a request header.
- **What CalcBloc records:** the API request log has the time, endpoint, country, response status and key id, without the amounts or your IP address. Like any website, the calcbloc.com web server and Cloudflare also keep standard access logs, which include the request address (with the inputs) and the requesting IP address; they are used only to run, secure and troubleshoot the service. See the [privacy policy](https://calcbloc.com/privacy) and the [API and data terms](https://calcbloc.com/developers/terms).
- **On your computer:** the server keeps the country list and tax tables in memory for six hours and writes nothing to disk.

## Data and accuracy

Tax figures come from official government and statutory publications, listed with each answer. They are estimates for information, not tax, legal or financial advice. The data is licensed under CC BY 4.0: "Data by CalcBloc (calcbloc.com/data)".

## Support

Report problems at [github.com/itmarkerz/calcbloc-mcp/issues](https://github.com/itmarkerz/calcbloc-mcp/issues) or email info@itmarkerz.co.in.
