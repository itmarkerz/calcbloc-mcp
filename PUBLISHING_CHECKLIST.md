# Publishing checklist

Steps to release `calcbloc-mcp` to npm and the official MCP Registry, then list it in directories.

**Status:** 0.1.0 was released on 2026-11-13 by hand: npm with option B (account `itmarkerz`, security-key 2FA, no provenance), then the MCP Registry with `mcp-publisher login github --token` (classic PAT, `read:org` only; the device flow cannot publish to an organization namespace). Directory listings (section 5) and trusted publishing for later releases (option A) are still to do.

## 1. Before the first release

- [ ] Decide the registry namespace. The repository uses `io.github.itmarkerz/calcbloc-mcp` (`mcpName` in `package.json`, `name` in `server.json`). The alternative `com.calcbloc/calcbloc-mcp` needs a DNS TXT record on calcbloc.com instead of GitHub organization ownership. Change both files together, before the first npm publish.
- [ ] Check that the npm name is still free: `npm view calcbloc-mcp` should return a 404.
- [ ] npm account: enable two-factor authentication for publishing (npmjs.com > Account > Two-Factor Authentication, "Authorization and writes"). If the package should belong to an npm organization, create it and add maintainers.
- [ ] Review `README.md`: remove the "Status: not yet published" note once the package is live.
- [ ] Run the full check locally (Node 20 or newer):

  ```bash
  npm ci
  npm run typecheck
  npm test
  npm pack --dry-run   # expect dist/, README.md, LICENSE, CHANGELOG.md, package.json only
  ```

- [ ] Optional live smoke test (uses about five anonymous API requests of the 50 a day; set `CALCBLOC_API_KEY` to avoid the limit):

  ```bash
  npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/call --tool-name calculate_take_home_pay --tool-arg country=uk --tool-arg gross_salary=50000
  ```

## 2. Version

- [ ] Set the same version in `package.json`, in `server.json` (`version` and `packages[0].version`), and in `CHANGELOG.md` (replace "unreleased" with the date).
- [ ] Commit, then tag: `git tag v0.1.0`.

## 3. Publish to npm

**Option A, recommended: GitHub Actions with provenance.** `.github/workflows/publish.yml` runs on a `v*` tag: it checks the versions, runs the tests, publishes to npm with `--provenance`, then publishes `server.json` to the MCP Registry.

- [ ] On npmjs.com, configure **trusted publishing** for the package: GitHub Actions, organization `itmarkerz`, repository `calcbloc-mcp`, workflow `publish.yml`, environment `release`. If npm requires the package to exist first, do the first release with option B, then switch.
- [ ] Alternatively add an `NPM_TOKEN` secret (granular token, publish rights for `calcbloc-mcp` only, short expiry) to the `release` environment.
- [ ] Create the `release` environment in the GitHub repository settings and restrict it to tags `v*`.
- [ ] Push the tag: `git push origin v0.1.0`, and watch the workflow.

**Option B: from your computer.** Provenance cannot be generated from a local machine, so this release will have none.

```bash
npm login
npm publish --access public   # npm asks for the 2FA code
```

After publishing:

- [ ] `npm view calcbloc-mcp` shows the version, licence MIT and `mcpName`.
- [ ] `npx -y calcbloc-mcp --version` prints the version.
- [ ] Add the server to one client (for example with the Cursor or VS Code snippet in the README) and run one calculation.

## 4. Publish to the official MCP Registry

Done by the workflow in option A (OIDC login, nothing to configure). By hand:

- [ ] Install `mcp-publisher` from https://github.com/modelcontextprotocol/registry/releases (or `brew install mcp-publisher`).
- [ ] `mcp-publisher validate`
- [ ] Log in. For the `io.github.itmarkerz` namespace you must be an Owner of the GitHub organization, and the device flow cannot see organization roles, so use a token: `mcp-publisher login github --token <PAT>` with a classic PAT that has `read:org` (or a fine-grained PAT with Organization > Members > Read-only). For a `com.calcbloc` name use `mcp-publisher login dns --domain calcbloc.com --private-key <key>` after adding the TXT record.
- [ ] `mcp-publisher publish`
- [ ] Check: `curl "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.itmarkerz/calcbloc-mcp"`

## 5. Directory listings

Texts and files are in [`directories/`](directories/README.md).

- [ ] Glama: add the repository at https://glama.ai/mcp/servers, then copy `directories/glama/glama.json` to the repository root with the maintainers' GitHub usernames and claim the listing.
- [ ] PulseMCP: usually imported from the MCP Registry; otherwise submit at https://www.pulsemcp.com/submit.
- [ ] mcp.so: submit at https://mcp.so/submit.
- [ ] awesome-mcp-servers: pull request with the line in `directories/awesome-mcp-servers/entry.md` (after the Glama listing exists, for the badge).
- [ ] Smithery: no submission path at the moment (directory only since 31 October 2026).
- [ ] calcbloc.com: consider a short "Use CalcBloc in AI assistants" section on [https://calcbloc.com/developers](https://calcbloc.com/developers?utm_source=calcbloc-mcp&utm_medium=docs&utm_campaign=itmarkerz-oss) linking to the npm package and repository.

## 6. Every later release

- [ ] Update the version in `package.json` and `server.json`, add a `CHANGELOG.md` entry, tag `vX.Y.Z` and push the tag.
- [ ] The MCP Registry rejects a version that already exists, so never reuse a version number.
