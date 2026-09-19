# CloudBase Hosted MCP OAuth Gateway

Private OAuth gateway that connects ChatGPT to Tencent CloudBase's official Hosted MCP.

## Architecture

```text
ChatGPT -> Cloudflare Worker OAuth gateway -> Tencent CloudBase Hosted MCP -> CloudBase environment
```

The Worker does not run the CloudBase MCP package locally. It authenticates the user with GitHub, allows only the configured owner account, exchanges the server-side CloudBase environment API key for an upstream Hosted MCP token, and proxies MCP traffic.

## Production endpoint

```text
https://cloudbase-hosted-oauth-staging.wenjinuu.workers.dev/mcp
```

Despite the historical `staging` name, this is the current canonical endpoint until a planned URL migration is performed.

## Required configuration

Non-secret variables in `wrangler.hosted-oauth-staging.jsonc`:

- `CLOUDBASE_ENV_ID`
- `GITHUB_CLIENT_ID`

Cloudflare Worker secrets:

- `CLOUDBASE_API_KEY`
- `GITHUB_CLIENT_SECRET`
- `COOKIE_ENCRYPTION_KEY`

KV binding:

- `OAUTH_KV`

## Commands

```bash
npm install
npm run type-check
npm run deploy
```

## Security boundaries

- The GitHub OAuth scope is `read:user`.
- Only GitHub user `wenjinliuu` may complete authorization.
- The CloudBase API key remains server-side in Cloudflare Secrets.
- OAuth state is one-time, session-bound, and stored temporarily in KV.
- Upstream credentials and Cloudflare forwarding headers are stripped from downstream traffic.
- CloudBase write operations remain powerful and should require explicit user confirmation.
