# CalcBloc MCP Server: tax tables and take-home pay for AI assistants

A Model Context Protocol (MCP) server that lets AI assistants calculate take-home pay, employer cost and income tax, look up official 2026 tax tables and compare countries, using CalcBloc's data. Every answer includes the tax year, the official source URL and the credit "Data by CalcBloc".

> **Status:** in development. This repository will hold the source code; nothing has been released yet.

## Planned tools

- `calculate_take_home_pay`: country, region, gross salary, tax year
- `get_tax_tables`: income tax brackets, social security rates and allowances for a country and year
- `compare_countries`: take-home pay for the same salary in two countries
- `employer_cost`: total cost of employment including employer contributions

It will be published as an npm package with setup instructions for the common MCP clients.

## Data and licence

Tax data comes from [CalcBloc](https://calcbloc.com/data): every figure is taken from the official government source named next to it, with the date it was last checked. Data licence: CC BY 4.0, credit "Data by CalcBloc (calcbloc.com/data)". Code licence: MIT.

## Links

- Website: [calcbloc.com](https://calcbloc.com)
- Tax tables and downloads: [calcbloc.com/data](https://calcbloc.com/data)
- API documentation: [calcbloc.com/developers](https://calcbloc.com/developers)
