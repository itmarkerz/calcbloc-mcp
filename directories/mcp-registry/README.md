# Official MCP Registry

The registry entry is [`server.json`](../../server.json) at the repository root (schema `2025-12-11`, validated against https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json). The registry stores metadata only; the package itself must be on npm first.

- Server name: `io.github.itmarkerz/calcbloc-mcp`. It must equal `mcpName` in `package.json` (already set), and the npm package must be published with that `mcpName` for the registry's ownership check.
- `version` in `server.json` (top level and in `packages[0]`) must match the published npm version. Update both on every release.
- The description is limited to 100 characters.

## Namespace and login

`io.github.itmarkerz/*` is an organization namespace. The registry grants it only to an **Owner** of the `itmarkerz` GitHub organization, and the interactive `mcp-publisher login github` device flow cannot currently prove organization ownership (registry issue #1468). Use one of:

1. **Personal access token:** a classic PAT with the `read:org` scope (or a fine-grained PAT with Organization permissions > Members > Read-only), then `mcp-publisher login github --token <TOKEN>`.
2. **GitHub Actions (OIDC):** publish from a workflow in this repository; see https://modelcontextprotocol.io/registry (GitHub Actions guide).

Alternative: a domain namespace such as `com.calcbloc/calcbloc-mcp`, proven with a DNS TXT record on the apex of calcbloc.com (`mcp-publisher login dns --domain calcbloc.com --private-key ...`). If you choose this, change `name` in `server.json` and `mcpName` in `package.json` before publishing to npm.

## Commands

```bash
# install mcp-publisher: download the binary for your OS from
# https://github.com/modelcontextprotocol/registry/releases (or: brew install mcp-publisher)
mcp-publisher validate            # checks server.json
mcp-publisher login github --token <TOKEN>
mcp-publisher publish
```

Check the result:

```bash
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.itmarkerz/calcbloc-mcp"
```

Several directories (PulseMCP among them) read from the official registry, so publishing here first helps the other listings.
