# mcp.so

Submit at https://mcp.so/submit (sign in with GitHub), or open an issue in the mcp.so repository linked from the site footer.

- **Type:** MCP Server
- **Name:** CalcBloc
- **URL:** https://github.com/itmarkerz/calcbloc-mcp
- **Description:** Take-home pay, employer cost, salary comparison and official tax tables for 37 countries. Every answer includes the tax year, official government source links and the credit "Data by CalcBloc". No API key required to start; a free key (`CALCBLOC_API_KEY`) is needed after 50 requests a day.
- **Category:** Finance
- **Tags:** tax, payroll, salary, income-tax, take-home-pay, employer-cost, tax-tables
- **Server config:**

```json
{
  "mcpServers": {
    "calcbloc": {
      "command": "npx",
      "args": ["-y", "calcbloc-mcp"],
      "env": { "CALCBLOC_API_KEY": "optional-free-key" }
    }
  }
}
```
