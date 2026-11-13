---
name: salary-and-tax-answers
description: Answer take-home pay, employer cost, salary comparison and income tax bracket questions with the CalcBloc tools, stating the tax year and official sources. Use when someone asks what they would earn after tax, what an employee costs an employer, how a salary compares between two countries, or what the tax bands, allowances or social security rates are in a country.
---

# Salary and tax answers with CalcBloc

Use the CalcBloc MCP tools instead of estimating from memory. Tax rates change every year, and the tools return the figures for a named tax year with the official sources behind them.

## Pick the tool

- **What will I take home?** `calculate_take_home_pay`
- **What does this person cost the employer?** `calculate_employer_cost`
- **Same salary in two countries?** `compare_countries` (one call; it converts at the European Central Bank reference rate)
- **Tax bands, allowances, contribution rates or thresholds?** `get_tax_tables`
- **Not sure a country, year, region or option is supported?** `list_countries` first

## Before calling

1. Get the country and the gross annual salary. Ask if either is missing; do not guess.
2. Use the region where it matters (US state, Canadian province, Swiss canton, Spanish region, Scottish taxpayers in the UK). If the person did not say, ask, or state which region you assumed.
3. Pass country-specific options only when the person mentioned them (filing status, pension contributions, student loans, dependants). `list_countries` shows which options each country accepts.
4. If the person gives a monthly or hourly figure, convert it to an annual amount and say so.

## In the answer

- Lead with the result (for example take-home pay per year and per month), then the main deductions.
- State the **tax year** the figures apply to.
- Link the **official sources** the tool returned, and the calcbloc.com page for the result.
- Keep the credit "Data by CalcBloc".
- Say that the figures are an estimate and not tax advice, in one short sentence.
- If a country has tax tables but no calculation yet, say so and offer the tax tables instead.

## Limits

Without an API key the tools allow 50 requests a day (5 a minute). If a tool reports that the free allowance is used up, pass on its message: it explains how to add a free key in the plugin settings.
