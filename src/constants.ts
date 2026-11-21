import { createRequire } from "node:module";
import { COVERAGE } from "./coverage.generated.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { name: string; version: string };

export const SERVER_NAME = pkg.name;
export const SERVER_VERSION = pkg.version;

export const DEFAULT_API_URL = "https://calcbloc.com/api/v1";
export const SITE_URL = "https://calcbloc.com";
export const DATA_URL = "https://calcbloc.com/data";
export const DEVELOPERS_URL = "https://calcbloc.com/developers";
export const API_KEY_URL = "https://calcbloc.com/developers/keys";
/** The keys page as linked in messages shown to people (referral tag, as on the other calcbloc.com links). */
export const API_KEY_URL_APP = `${API_KEY_URL}?utm_source=calcbloc-mcp&utm_medium=app&utm_campaign=itmarkerz-oss`;

/**
 * Scope note quoted by the calculation tools: where bonus and equity questions go (with the countries each covers) and
 * what is not supported yet. Generated with the coverage (scripts/gen-coverage.mjs), like the README coverage block.
 */
export const NOT_SUPPORTED: string = COVERAGE.notSupported;
/** The part of the scope note that is not supported by any tool yet (quoted by the supplemental and equity tools). */
export const NOT_YET_SUPPORTED: string = COVERAGE.notYetSupported;

/** The credit that must accompany every figure. */
export const ATTRIBUTION = "Data by CalcBloc";
export const DATA_LICENCE = "CC BY 4.0";

export const DISCLAIMER =
  "Estimate for information only, not tax, legal or financial advice. Figures follow the official sources listed; check them, or ask a qualified adviser, before making decisions.";

export const SERVER_INSTRUCTIONS = [
  "CalcBloc tools calculate take-home pay, employer cost, cross-country salary comparisons, tax withheld on bonuses and other supplemental pay, and tax on RSUs and stock options, and return official tax tables (income tax bands, social security rates, allowances).",
  "Call list_countries first when unsure which countries, regions or extra options are supported; calculations exist for some countries, tax tables for all listed countries.",
  "Calculations use each country's current tax year; earlier years are available as tax tables.",
  "When you present results, state the tax year, link the official source URL(s) and the calcbloc.com page, credit \"Data by CalcBloc\", and say that the figures are an estimate, not tax advice.",
].join(" ");
