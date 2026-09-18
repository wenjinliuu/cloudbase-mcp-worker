import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { GitHubHandler } from "./github-handler";

const CLOUDBASE_HOSTED_MCP = "https://tcb-api.cloud.tencent.com/mcp/v1";

// Tencent's hosted MCP E2E suite currently pins this negotiated version.
// Rewriting only the initialize request keeps newer MCP clients compatible
// with the hosted endpoint without changing tool payloads.
const CLOUDBASE_PROTOCOL_VERSION = "2025-06-18";

type ProxyEnv = Env & {
	CLOUDBASE_API_KEY?: string;
	CLOUDBASE_ENV_ID?: string;
};

function cleanForwardHeaders(source: Headers, apiKey: string): Headers {
	const headers = new Headers(source);

	// The incoming Authorization header authenticates ChatGPT to this Worker.
	// Never forward it upstream. Tencent Hosted MCP receives only the
	// environment-scoped CloudBase API Key.
	headers.set("Authorization", `Bearer ${apiKey}`);

	for (const name of [
		"host",
		"content-length",
		"cookie",
		"cf-connecting-ip",
		"cf-ipcountry",
		"cf-ray",
		"cf-visitor",
		"x-forwarded-for",
		"x-forwarded-proto",
		"x-real-ip",
	]) {
		headers.delete(name);
	}

	return headers;
}

async function proxyToCloudBase(
	request: Request,
	env: ProxyEnv,
): Promise<Response> {
	const apiKey = env.CLOUDBASE_API_KEY;
	const envId = env.CLOUDBASE_ENV_ID;

	if (!apiKey || !envId) {
		return new Response(
			JSON.stringify({
				error: "CloudBase upstream credentials are not configured.",
			}),
			{
				status: 500,
				headers: { "Content-Type": "application/json" },
			},
		);
	}

	const upstreamUrl = new URL(CLOUDBASE_HOSTED_MCP);
	upstreamUrl.searchParams.set("env_id", envId);

	const headers = cleanForwardHeaders(request.headers, apiKey);
	let body: BodyInit | null | undefined;

	if (request.method !== "GET" && request.method !== "HEAD") {
		const contentType = request.headers.get("content-type") ?? "";

		if (
			request.method === "POST" &&
			contentType.toLowerCase().includes("application/json")
		) {
			const raw = await request.text();

			try {
				const message = JSON.parse(raw);
				if (
					message &&
					!Array.isArray(message) &&
					message.method === "initialize" &&
					message.params &&
					typeof message.params === "object"
				) {
					message.params.protocolVersion = CLOUDBASE_PROTOCOL_VERSION;
					body = JSON.stringify(message);
					headers.set("Content-Type", "application/json");
				} else {
					body = raw;
				}
			} catch {
				body = raw;
			}
		} else {
			body = request.body;
		}
	}

	// If a newer client sends the protocol header before/after negotiation,
	// present the hosted endpoint with the version it currently supports.
	if (headers.has("MCP-Protocol-Version")) {
		headers.set("MCP-Protocol-Version", CLOUDBASE_PROTOCOL_VERSION);
	}

	try {
		return await fetch(upstreamUrl.toString(), {
			method: request.method,
			headers,
			body,
			redirect: "manual",
		});
	} catch (error) {
		console.error(
			"CloudBase Hosted MCP proxy error:",
			error instanceof Error ? error.message : String(error),
		);
		return new Response(
			JSON.stringify({
				error: "CloudBase Hosted MCP upstream request failed.",
			}),
			{
				status: 502,
				headers: { "Content-Type": "application/json" },
			},
		);
	}
}

const apiHandler = {
	async fetch(request: Request, env: ProxyEnv) {
		return proxyToCloudBase(request, env);
	},
};

export default new OAuthProvider({
	apiHandler,
	apiRoute: "/mcp",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: GitHubHandler as any,
	tokenEndpoint: "/token",
});
