# CalcBloc plugin: take-home pay, employer cost and official tax tables

CalcBloc gives Claude sourced answers to payroll and income tax questions. Ask what you would take home on a salary, what an employee costs an employer, how the same salary compares between two countries, or what the income tax bands, allowances and social security rates are. It covers take-home pay and employer cost for 12 countries (the United States with every state, the United Kingdom, Canada, Australia, New Zealand, Ireland, India, Germany, France, Spain, the Netherlands and Singapore) and official tax tables for 37 countries. Every answer states the tax year and links the official government sources behind the rates.

CalcBloc is a product of [itmarkerz technologies](https://itmarkerz.co.in).

## What you can ask

- "What is my take-home pay on $85,000 in California, filing single?"
- "How much does it cost a German employer to hire someone on €60,000?"
- "Compare £50,000 in Scotland with the same salary in Germany."
- "Show me the 2026 Ontario income tax brackets and where they come from."

## What the plugin contains

- **A connection to the CalcBloc MCP server** at `https://calcbloc.com/mcp`, run by itmarkerz technologies. Nothing is installed or run on your computer. The server has five read-only tools: `calculate_take_home_pay`, `calculate_employer_cost`, `compare_countries`, `get_tax_tables` and `list_countries`. They are the tools of the open-source [calcbloc-mcp](https://github.com/itmarkerz/calcbloc-mcp) package (MIT), which you can also run yourself with `npx -y calcbloc-mcp`.
- **A skill, `salary-and-tax-answers`,** that tells Claude which tool to use, which details to ask for (country, salary, region), and to state the tax year and sources in its answer.

## What it sends and where

When Claude uses a tool, the plugin sends the tool's inputs to `https://calcbloc.com/mcp` over HTTPS: the country, the tax year, the region, the salary amount and the options you mention (such as filing status or pension contributions). The server answers from CalcBloc's own calculators and tax tables and contacts no other service. Nothing else is sent: the plugin does not read your files, your conversation or your Claude account.

- **API key:** optional. Without one, each address gets 500 tool API calls a day (30 a minute), within a shared daily total. A free key from [calcbloc.com/developers/keys](https://calcbloc.com/developers/keys) gives you your own allowance of 5,000 a day; enter it in the plugin's settings, where it is stored in your system's secure credential store and sent only to calcbloc.com in the `X-API-Key` request header.
- **What CalcBloc records:** a log line per API call with the time, endpoint, country, response status and key id, without the amounts or your IP address. Rate-limit counters use a one-way hash of the address. The calcbloc.com web server and Cloudflare keep standard access logs of requests to `/mcp` with the requesting IP address; the inputs travel in the request body and are not in those logs. Logs are used only to run, secure and troubleshoot the service. See the [privacy policy](https://calcbloc.com/privacy) and the [API and data terms](https://calcbloc.com/developers/terms).

## Data and accuracy

Tax figures come from official government and statutory publications, listed with each answer. They are estimates for information, not tax, legal or financial advice. The data is licensed under CC BY 4.0: "Data by CalcBloc (calcbloc.com/data)".

## Support

Report problems at [github.com/itmarkerz/calcbloc-mcp/issues](https://github.com/itmarkerz/calcbloc-mcp/issues) or email info@itmarkerz.co.in.
