# Changelog

All notable changes to this package are listed here. The package follows [semantic versioning](https://semver.org/).

## 0.5.0 (2026-11-27)

One new tool on CalcBloc API 1.10 (fourteen in all, every one read-only), the verification marker on take-home pay and employer cost, and Denmark, Estonia and Poland. Every input that worked in 0.4.0 still works. Against an API older than 1.10, `get_tax_treaties` answers that the API does not offer treaties yet, and the other tools work as before.

- **`get_tax_treaties`.** The double taxation treaties the API stores for a country (`/tax-treaties`): India's treaties with the United States, Singapore, the United Kingdom, Japan, Australia and Austria. Each treaty comes with the maximum withholding tax the source country may charge on dividends (and the lower rate for a qualifying shareholding), interest, royalties and fees for technical services, each with its condition and article. It also gives each country's relief method (credit or exemption), the signature and entry-into-force dates, whether the MLI modifies the treaty, and the official copy it was read from (IRS, IRAS, HMRC, Japan's Ministry of Finance, the ATO, Austria's Federal Ministry of Finance). With `partner` (an ISO code such as `us`, `uk` or `gb`, or a name), it returns one treaty and quotes each article's wording. Countries are resolved like the other tools' country arguments. A country without treaties returns the countries that have them, and a partner without a stored treaty says so. The answer says that nothing is computed and that domestic rates, beneficial ownership, the MLI principal purpose test and anti-abuse rules still apply. It ends with the credit footer and the "not tax advice" note.
- **Verification marker.** `calculate_take_home_pay` and `calculate_employer_cost` show how a calculation on CalcBloc's shared take-home engine was verified. They say either "checked against an official worked example" (`official-example`: Estonia, Poland) or "computed from the law text; no official example is published" (`law-text`: Denmark), followed by the official URLs from the API's first note. The marker appears in the text and as `verification` (`status`, `label`, `urls`) in the structured result. It is null for countries with their own engine. `list_countries` with a country shows the same status for each calculation.
- **Denmark, Estonia and Poland.** These countries now have take-home pay, employer cost and comparison. Their options pass through the generic `options` argument and are checked against `/countries` like every other country's: Denmark `municipality` (kommune number or name, e.g. "København"), `church` and `atp_hours`; Estonia `funded_pension` (by value or label, e.g. "6%") and `pension_age`; Poland `accident_rate_pct` and `commuter`.
- **Coverage.** Generated from the API 1.10 code (`node scripts/gen-coverage.mjs --site=../calcbloc`, since 1.10 is not live yet): 217 countries with tax tables, tax facts and tax calendars (from 133); 15 with take-home pay, 14 with employer cost, 15 in the comparison. The scope note now says that the double-tax relief amount is not computed, and points to `get_tax_treaties` for the treaty withholding limits. The README coverage block lists the tax treaties.
- **Tests.** `test/phase4.test.ts` adds schema, behaviour and golden tests on responses captured from the API 1.10 code with the site's own handlers: India's six treaties (India-US dividends 15% under Article 10(2)(a), India-Japan 10% throughout, India-UK in force 1993-10-25), the partner spellings, a country without treaties, an API without `/tax-treaties`, Estonia take-home pay (EMTA worked examples), Poland employer cost (biznes.gov.pl worked example) and Denmark (law text). The stdio test calls the new tool and checks the marker through the SDK's output validation. `test:schema` and `test:golden` include the new file. 132 tests in all.

## 0.4.0 (2026-11-27)

Six new tools on CalcBloc API 1.9 (thirteen in all, every one read-only). Every input that worked in 0.3.0 still works. The new tools need API 1.9, which calcbloc.com has served since 2026-11-26.

- **`calculate_import_duty`.** Duties, import VAT, excise and landed cost of one import into the UK, an EU member state, the United States or India, from the official tariffs the API serves (UK Trade Tariff, EU TARIC, US HTS, India's Customs Tariff), with the preference that applies for the origin and proof of origin, extra duties (Section 301 and 232, anti-dumping) and entry fees. Totals say when they are incomplete (excise code missing, exporter-specific duties). The credit footer says the result is not a customs ruling.
- **`get_tariff`.** The tariff lines for a commodity code, with duty rates and preferences grouped by duty, or for one origin only its best preference.
- **`list_trade_agreements`.** The trade agreements and preference schemes in a tariff, or one agreement with its rules of origin and official sources.
- **`get_tax_calendar`.** A country's tax year (start, end, days left), the next tax year, enacted and announced changes with their official sources, and the next budget date when one is published; without a country, one line per country.
- **`search_tax_facts`.** Tax facts (API v2 facts) by country, region, jurisdiction and tax type, for example UK income tax bands or California sales and use tax.
- **`calculate_cross_border_equity`.** An RSU vest or option exercise split between the countries a mobile employee worked in from grant to vest (workday sourcing, each country's own rule such as Treas. Reg. § 1.861-4 or HMRC's relevant period), with each share's estimated tax for 10 countries and the double-tax relief flagged.
- **Coverage.** Generated from `/api/v1/countries` of API 1.9: 133 countries with tax tables, tax facts and tax calendars; the calculation counts are unchanged. The scope note now says that cross-border salary withholding and treaty rates are not supported yet.
- **Tests.** `test/phase3.test.ts`: schema, behaviour and golden tests on responses captured from API 1.9 (UK coffee from India under the India-UK CETA, German screws from China, US furniture from China with the Section 301 duty, the UK 2026-27 tax calendar, US→UK RSUs and Canada→US options). 115 tests in all.

## 0.3.0 (2026-11-22)

Two new tools on CalcBloc API 1.8 (`/supplemental-withholding` and `/equity-tax`). Every input that worked in 0.2.0 still works. Against an API older than 1.8 the new tools answer that the API does not offer them yet.

- **`calculate_supplemental_withholding`.** Tax withheld on a bonus, commission, RSU vest, stock option exercise or lump sum paid on top of a regular salary, using the country's official method (IRS Pub 15 flat 22% and the mandatory 37% over $1 million, HMRC cumulative PAYE, CRA T4127 bonus method, ATO Schedule 5, IRD extra-pay rates and others), line by line, next to the final tax the payment adds at the person's real rates. 12 countries: `sg`, `fr`, `nl`, `es`, `de`, `us`, `uk`, `au`, `nz`, `ca`, `ie`, `in`. Australia takes `bonus`, `commission` and `lump_sum` only; Ireland has no `option_exercise`.
- **`calculate_equity_tax`.** Income tax, social security and withholding when RSUs vest or options are exercised, and capital gains tax on a sale, with flags (AMT exposure, scheme conditions assumed) and alternative scenarios (qualifying vs disqualifying ISO disposition). 5 countries: `us` (rsu, nso, iso), `uk` (rsu, emi, csop, unapproved_option), `au` (ess_upfront, ess_deferred, rsu), `ca` (stock_option), `in` (esop, rsu).
- **Same checks as the other calculations.** Short codes, names and older keys for the country; region names and codes, required where the API requires them (supplemental: `us`, `ca`; equity: `ca`) and checked before any request; options validated against each country's parameters, with the API's aliases and labels (`filing_status` "married", `readily_convertible` "no", UK region "England & Northern Ireland"). A payment type or instrument the country does not have returns that country's list, and an unsupported country returns the countries that are supported, both from `/countries`. `type` and `instrument` are enums in the input schemas.
- **Credit footer** on both tools: tax year, the official sources the API returns for the figures, the calcbloc.com page (the bonus or stock option calculator where the API names one, otherwise the country's tax-table page), "Data by CalcBloc" and the estimate disclaimer. Structured output schemas for both.
- **`list_countries`** shows, per country, whether supplemental withholding and equity tax are available (`supplementalWithholding`, `equityTax`), and for one country its payment types, instruments, regions and options.
- **Scope note and coverage.** `scripts/gen-coverage.mjs` now also generates the supplemental and equity country lists, payment types, instruments and region requirements, and the scope note quoted by the calculation tools and the README: bonus and equity questions go to the new tools; cross-border (multi-country) withholding is still not supported.
- **Tests.** `test/phase2.test.ts`: schema tests (countries, required parameters, enums, scope note), behaviour tests (aliases, region errors, unsupported countries, types and instruments, pass-through of API errors) and golden tests on responses captured from the API 1.8 code: the US $1 million rule (22% to $1 million, 37% above), a $10,000 bonus at the 24% bracket, UK PAYE, German § 39b, HMRC ETASSUM57030 Example 1 (EMI, £2,000 charged), a US RSU vest and IRS Pub 525 Example 8 (ISO). `test:schema` and `test:golden` run them in CI.

## 0.2.0 (2026-11-21)

Fixes for the issues found in the CorpusIQ review. Every input that worked in 0.1.x still works.

- **Region requirement is stated and checked.** The descriptions of `calculate_take_home_pay` and `calculate_employer_cost` name the countries where `region` is required (generated from `GET /api/v1/countries`: take-home pay `us`, `ca`; employer cost `us`, `au`, `ca`). A call without the region now fails at once, before any API request, with every valid code and its name (`ca (California)`, `ny (New York)` …). An unknown region lists the codes and names too, and region names work as well as codes ("California"). `compare_countries` documents `region_a` / `region_b` with their defaults.
- **Consistent codes and option values.** Countries are shown and documented by their short code: ISO 3166-1 alpha-2 in lower case, with the UK as `uk` (`gb` also works). Examples: `nz` instead of `new-zealand`, `de` instead of `germany`. Older keys, ISO codes and English names keep working. Option values accept common spellings and labels, case-insensitively: `filing_status` `married`, `married_joint` or "Married filing jointly" mean `mfj`, and `head_of_household` means `hoh`. They come from the API's own alias lists (API 1.7), with a built-in fallback for older API versions. The `filing_status: "married"` example is corrected to `mfj` everywhere.
- **Generated coverage.** Tool descriptions, the README coverage block and the manifest descriptions quote counts generated by `scripts/gen-coverage.mjs` from `/api/v1/countries`. Today: 41 countries with tax tables, 12 with take-home pay, 11 with employer cost and 12 in the comparison; France has take-home pay and compare only. `list_countries` now reports employer-cost and compare counts and each country's short code (`shortCode`), and marks required regions.
- **Scope note.** The calculation tools and the README say that equity compensation (RSUs, stock options), bonus and supplemental withholding, and cross-border withholding are not supported yet.
- **Rate limits.** Limit messages no longer state fixed numbers: they quote the daily limit the API reports (`X-RateLimit-Limit`) and say to get a free key (email only) and set `CALCBLOC_API_KEY`. The API's keyless allowance went up from 50 a day / 5 a minute to 300 a day / 20 a minute (API 1.7).
- **CI.** Pull requests now also run a coverage check (the generated text must match the API capture), schema tests (descriptions, enums, region requirement, no invalid examples) and golden tests: a $100,000 single filer in California, 2026, checked against IRS Rev. Proc. 2025-32, Pub 15/15-T, EDD DE 44 and FTB figures.

## 0.1.3 (2026-11-13)

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
