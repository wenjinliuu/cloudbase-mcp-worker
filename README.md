# CloudBase MCP on Cloudflare Workers

One repository, two independently deployable Cloudflare Workers:

| Variant        | Config                                | MCP implementation                                        | Status                   |
| -------------- | ------------------------------------- | --------------------------------------------------------- | ------------------------ |
| Hosted gateway | `wrangler.hosted-oauth-staging.jsonc` | Proxies Tencent CloudBase Hosted MCP                      | Existing production path |
| Direct V2      | `wrangler.direct-v2.jsonc`            | Runs `@cloudbase/cloudbase-mcp` inside Cloudflare Workers | Compatibility rollout    |

Both variants keep CloudBase credentials in Cloudflare Secrets and use the same private GitHub OAuth allowlist.

## Architectures

Hosted gateway:

```text
ChatGPT -> Cloudflare OAuth Worker -> Tencent Hosted MCP -> CloudBase
```

Direct V2:

```text
ChatGPT -> Cloudflare OAuth Worker + CloudBase MCP -> Tencent CloudBase APIs
```

The existing Hosted endpoint remains:

```text
https://cloudbase-hosted-oauth-staging.wenjinuu.workers.dev/mcp
```

## Direct V2 compatibility policy

- `@cloudbase/cloudbase-mcp` is pinned to `2.34.4` and `@cloudbase/manager-node` to `5.8.8`.
- `compatibility_date` is `2026-09-20`, which includes Cloudflare's current Node.js compatibility behavior.
- Cloud Mode is mandatory.
- The Web Standard Streamable HTTP transport runs statelessly with JSON responses.
- Tencent telemetry transmission is disabled.
- The official `rag` plugin is disabled because it still downloads a template and writes a home-directory cache during initialization, even in Cloud Mode.
- The S3 SDK import used only by local archive paths is replaced with a fail-closed stub so Wrangler can bundle the official package without adding an unused AWS SDK.
- Official Cloud Mode filtering currently leaves 33 cloud-oriented tools. Local-only tools such as `downloadTemplate`, declarative local deploy, file-based storage writes, and local Cloud Run deploy are intentionally not exposed.

## Commands

```bash
npm ci
npm run type-check
npm run check:direct-v2
npm run deploy:hosted
npm run deploy:direct-v2
```

The default `npm run deploy` still deploys the existing Hosted gateway.

## Direct V2 Cloudflare configuration

Create a second Worker connected to this repository and use the Direct V2 branch as its production branch.

Build command:

```text
npm ci && npm run type-check
```

Deploy command:

```text
npm run deploy:direct-v2
```

Required Worker secrets:

- `CLOUDBASE_API_KEY`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `COOKIE_ENCRYPTION_KEY`

Optional Tencent Cloud credentials for management-plane APIs that an environment API key cannot call:

- `TENCENTCLOUD_SECRETID`
- `TENCENTCLOUD_SECRETKEY`
- `TENCENTCLOUD_SESSIONTOKEN` when temporary credentials are used

The Secret ID and Secret Key must always be configured together.

The Direct V2 Worker needs its own GitHub OAuth App because its `workers.dev` hostname differs from the Hosted Worker. Set its callback URL to:

```text
https://<direct-v2-worker-hostname>/callback
```

Point ChatGPT at:

```text
https://<direct-v2-worker-hostname>/mcp
```

## Security boundaries

- GitHub OAuth requests only the `read:user` scope.
- Only GitHub user `wenjinliuu` may complete authorization.
- CloudBase and Tencent Cloud credentials remain server-side in Cloudflare Secrets.
- OAuth state is one-time, browser-session-bound, and stored temporarily in KV.
- Direct V2 telemetry transmission is disabled.
- CloudBase write tools are powerful and should be exercised only after read-only acceptance tests pass.
