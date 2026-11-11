# Changelog

All notable changes to this package are listed here. The package follows [semantic versioning](https://semver.org/).

## 0.1.0 (unreleased)

First version.

- Rate limits without a key: when the 50-a-day allowance runs out (429, or `X-RateLimit-Remaining: 0` on a keyless request), tool errors say "Add your free API key", link to the keys page and name the `CALCBLOC_API_KEY` variable; no further requests are sent until the limit resets.

- MCP server over stdio, built on the MCP TypeScript SDK v2 (`@modelcontextprotocol/server` 2.4, MCP specification 2026-07-28).
- Tools: `calculate_take_home_pay`, `calculate_employer_cost`, `compare_countries`, `get_tax_tables` and `list_countries`, all read-only, with input and output schemas and structured results.
- Every result states the tax year, the official source URLs for the rates used, the calcbloc.com page and the credit "Data by CalcBloc", with an "estimate, not tax advice" note.
- Country names, codes and common aliases; region names or codes; country-specific options validated against the live parameter list from `GET /api/v1/countries`.
- Clear messages for countries that have tax tables but no calculation yet, for earlier tax years, and for rate limits (with a link to the free API key).
- Optional `CALCBLOC_API_KEY`, `CALCBLOC_DATA_DIR` (offline tax tables from the CalcBloc data files), `CALCBLOC_API_URL` and `CALCBLOC_TIMEOUT_MS`.
- In-memory caching of the country list and tax tables (six hours).
