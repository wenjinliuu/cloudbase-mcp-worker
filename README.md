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

## CloudBase CLI deploy (companion to the MCP)

Code deployment goes through git → GitHub Actions, not through the MCP (the hosted MCP runs in cloud mode and cannot upload function code).

- Reusable workflow: `.github/workflows/cloudbase-deploy.yml` — other repos call it with `uses: wenjinliuu/cloudbase-mcp-worker/.github/workflows/cloudbase-deploy.yml@main`.
- Credential check: `.github/workflows/cloudbase-cli-check.yml` (manual, read-only).
- Setup guide, secret instructions and the 2026-10-31 audit (中文): [docs/cloudbase-cli.md](docs/cloudbase-cli.md).

## Security boundaries

- The GitHub OAuth scope is `read:user`.
- Only GitHub user `wenjinliuu` may complete authorization.
- The CloudBase API key remains server-side in Cloudflare Secrets.
- OAuth state is one-time, session-bound, and stored temporarily in KV.
- Upstream credentials and Cloudflare forwarding headers are stripped from downstream traffic.
- CloudBase write operations remain powerful and should require explicit user confirmation.
