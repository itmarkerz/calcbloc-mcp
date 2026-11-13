# Changelog

All notable changes to this package are listed here. The package follows [semantic versioning](https://semver.org/).

## Unreleased

- Country codes and local names for Ukraine (UA, Ukraina, Україна), Liechtenstein (LI), Serbia (RS, Srbija, Србија) and Türkiye (TR, Turkiye), now that calcbloc.com publishes their tax tables (41 countries).

## 0.1.2 (2026-11-13)

- The API key can also come from `CLAUDE_PLUGIN_OPTION_CALCBLOC_API_KEY`, the name the CalcBloc Claude plugin passes its optional key setting under. `CALCBLOC_API_KEY` still comes first. Empty values and placeholders a client left unsubstituted (such as `${user_config.calcbloc_api_key}`) count as no key, so the free allowance is used instead of every request failing with an invalid key.
- Trailing slashes in `CALCBLOC_API_URL` are trimmed with a loop instead of a regular expression that CodeQL flagged as slow on long runs of `/` (js/polynomial-redos).
- Repository: Dependabot (npm and GitHub Actions, weekly, grouped) and CodeQL code scanning are enabled.

## 0.1.1 (2026-11-13)

Documentation and release process only; the server is unchanged.

- README: install with `npx -y calcbloc-mcp` (the package is on npm and in the official MCP Registry), with npm, MCP Registry and licence badges. The npm page now shows this README instead of the pre-release "not yet published" note.
- Releases: version tags stage the package on npm through trusted publishing (approved by a maintainer on npmjs.com), and a separate, manually run workflow publishes `server.json` to the MCP Registry after approval.

## 0.1.0 (2026-11-13)

First version.

- Rate limits without a key: when the 50-a-day allowance runs out (429, or `X-RateLimit-Remaining: 0` on a keyless request), tool errors say the free allowance without a key is used up and "Add your free API key", link to the keys page and name the `CALCBLOC_API_KEY` variable; no further requests are sent until the limit resets.
- MCP server over stdio, built on the MCP TypeScript SDK v2 (`@modelcontextprotocol/server` 2.4, MCP specification 2026-07-28).
- Tools: `calculate_take_home_pay`, `calculate_employer_cost`, `compare_countries`, `get_tax_tables` and `list_countries`, all read-only, with input and output schemas and structured results.
- Every result states the tax year, the official source URLs for the rates used, the calcbloc.com page and the credit "Data by CalcBloc", with an "estimate, not tax advice" note.
- Country names, codes and common aliases (ISO codes and some local names, such as Deutschland, Hrvatska or Eesti) for all 37 countries; region names or codes; country-specific options validated against the live parameter list from `GET /api/v1/countries`.
- Clear messages for countries that have tax tables but no calculation yet, for earlier tax years, and for rate limits (with a link to the free API key).
- Optional `CALCBLOC_API_KEY`, `CALCBLOC_DATA_DIR` (offline tax tables from the CalcBloc data files), `CALCBLOC_API_URL` and `CALCBLOC_TIMEOUT_MS`.
- In-memory caching of the country list and tax tables (six hours).
