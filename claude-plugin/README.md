# Finny for Claude

Read-only access to Finny's transactions from Claude.

## Claude Code

```bash
# Optional: export FINNY_MCP_URL=... to point at a different deployment
claude plugin marketplace add PranavRNambiar/hermes-finny-dashboard
claude plugin install finny@finny
```

Then run `/mcp` → finny → Authenticate, and enter the owner password in the browser.
Commands: `/finny:month-review`, `/finny:who-owes-me`. Plain questions work too ("how much did I spend on food in September?").

## claude.ai, Claude Desktop and Claude mobile

Settings → Connectors → Add custom connector → URL `https://dashboard-five-jade-19.vercel.app/api/mcp` → Connect → enter the owner password.
Once it's added on claude.ai, the connector also works in Claude Desktop and Claude mobile.

## ChatGPT

Settings → Apps → Advanced → Developer mode on → Create app → same URL, authentication **OAuth** → enter the owner password.
