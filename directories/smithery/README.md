# Smithery

Smithery (now part of Arcade) shut down its connection services on 31 October 2026: hosted server URLs, Smithery accounts and API keys stopped working, and its CLI and SDKs are deprecated. smithery.ai continues as a public directory with a curated set of verified servers (announcement: https://smithery.ai/future).

There is therefore no `smithery.yaml` in this repository and nothing to deploy. If Smithery opens submissions to its directory again, use the shared listing text in [../README.md](../README.md) and this configuration:

```json
{
  "mcpServers": {
    "calcbloc": {
      "command": "npx",
      "args": ["-y", "calcbloc-mcp"]
    }
  }
}
```
