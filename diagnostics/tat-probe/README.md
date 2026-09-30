# TAT hosted MCP connectivity probe

Independent Cloudflare Worker; does not replace either CloudBase gateway.

- Only initialize, notifications/initialized and tools/list are sent upstream.
- No tools/call, server commands or deployment operations are exposed.
- POST /probe requires a Bearer PROBE_TOKEN.
- GET /healthz exposes only static readiness metadata.
- TAT_UPSTREAM_URL and PROBE_TOKEN must be Cloudflare secret bindings.
- Secret URLs, upstream error bodies and credential values are never returned.
- The SSE connection and all reads are bounded by a 20-second deadline.

Run locally: node --test diagnostics/tat-probe/test.mjs

Remote test on 2026-09-30: deployment and Cloudflare browser request succeeded; upstream TAT SSE connection timed out after 20 seconds before any HTTP status was received. This does not prove the CAM credentials are wrong, and does not prove ChatGPT's failure has the same cause. Tencent's built-in online tool test should verify the hosted endpoint before creating a production OAuth gateway.
