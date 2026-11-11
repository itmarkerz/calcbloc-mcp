import { createRequire } from "node:module";

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

/** The credit that must accompany every figure. */
export const ATTRIBUTION = "Data by CalcBloc";
export const DATA_LICENCE = "CC BY 4.0";

export const DISCLAIMER =
  "Estimate for information only, not tax, legal or financial advice. Figures follow the official sources listed; check them, or ask a qualified adviser, before making decisions.";

export const SERVER_INSTRUCTIONS = [
  "CalcBloc tools calculate take-home pay, employer cost and cross-country salary comparisons, and return official tax tables (income tax bands, social security rates, allowances).",
  "Call list_countries first when unsure which countries, regions or extra options are supported; calculations exist for some countries, tax tables for all listed countries.",
  "Calculations use each country's current tax year; earlier years are available as tax tables.",
  "When you present results, state the tax year, link the official source URL(s) and the calcbloc.com page, credit \"Data by CalcBloc\", and say that the figures are an estimate, not tax advice.",
].join(" ");
