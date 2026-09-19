import { createCloudBaseMcpServer } from "@cloudbase/cloudbase-mcp";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { GitHubHandler } from "./github-handler";
import type { Props } from "./utils";

type DirectV2WorkerEnv = Env & {
	CLOUDBASE_API_KEY?: string;
	CLOUDBASE_ENV_ID?: string;
	CLOUDBASE_MCP_CLOUD_MODE?: string;
	CLOUDBASE_MCP_TELEMETRY_DISABLED?: string;
	TCB_LANG?: string;
	TCB_SITE?: string;
	TENCENTCLOUD_SECRETID?: string;
	TENCENTCLOUD_SECRETKEY?: string;
	TENCENTCLOUD_SESSIONTOKEN?: string;
};

type AuthenticatedContext = ExecutionContext & {
	props?: Props;
};

const ALLOWED_GITHUB_LOGIN = "wenjinliuu";
const CLOUDBASE_MCP_VERSION = "2.34.4";

function assertBindings(env: DirectV2WorkerEnv): void {
	if (!env.CLOUDBASE_API_KEY || !env.CLOUDBASE_ENV_ID) {
		throw new Error("Missing required CloudBase Worker bindings.");
	}

	if (env.CLOUDBASE_MCP_CLOUD_MODE !== "true") {
		throw new Error("CloudBase MCP Cloud Mode must be enabled.");
	}

	const hasSecretId = Boolean(env.TENCENTCLOUD_SECRETID);
	const hasSecretKey = Boolean(env.TENCENTCLOUD_SECRETKEY);
	if (hasSecretId !== hasSecretKey) {
		throw new Error(
			"TENCENTCLOUD_SECRETID and TENCENTCLOUD_SECRETKEY must be configured together.",
		);
	}
}

function safeErrorMessage(error: unknown): string {
	if (!(error instanceof Error)) return "Unknown error";
	return error.message
		.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
		.replace(/eyJ[A-Za-z0-9._~-]{20,}/g, "[redacted-token]")
		.slice(0, 500);
}

async function handleDirectMcp(request: Request, env: DirectV2WorkerEnv): Promise<Response> {
	if (!["GET", "POST", "DELETE"].includes(request.method)) {
		return new Response("Method not allowed", {
			status: 405,
			headers: { Allow: "GET, POST, DELETE" },
		});
	}

	assertBindings(env);

	// A fresh server and transport per request is the MCP SDK's stateless Worker pattern.
	// JSON responses avoid holding an SSE connection open for ordinary ChatGPT calls.
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	const server = await createCloudBaseMcpServer({
		name: "cloudbase-mcp-direct-v2",
		version: CLOUDBASE_MCP_VERSION,
		cloudMode: true,
		// The official package currently couples Cloud Mode tool filtering to its
		// telemetry wrapper. Keep the wrapper enabled, while the Wrangler binding
		// CLOUDBASE_MCP_TELEMETRY_DISABLED=true prevents telemetry transmission.
		enableTelemetry: true,
		client: "chatgpt",
		lang: env.TCB_LANG || "zh",
		// The official RAG plugin downloads a template and writes a home-directory
		// cache even in Cloud Mode. It is documentation search, not cloud management,
		// so exclude it on Workers until upstream makes it filesystem-free.
		pluginsDisabled: ["rag"],
	});

	await server.connect(transport);
	return transport.handleRequest(request);
}

const directMcp = {
	async fetch(request, env, ctx) {
		const props = (ctx as AuthenticatedContext).props;
		if (props?.login !== ALLOWED_GITHUB_LOGIN) {
			return new Response("Forbidden", { status: 403 });
		}

		try {
			return await handleDirectMcp(request, env);
		} catch (error) {
			console.error("Direct CloudBase MCP request failed:", safeErrorMessage(error));
			return Response.json(
				{
					jsonrpc: "2.0",
					error: {
						code: -32603,
						message: "CloudBase MCP request failed.",
					},
					id: null,
				},
				{ status: 500 },
			);
		}
	},
} satisfies ExportedHandler<DirectV2WorkerEnv>;

const directDefaultHandler = {
	async fetch(request, env, ctx) {
		if (new URL(request.url).pathname === "/health") {
			return Response.json({
				ok: true,
				variant: "cloudbase-mcp-direct-v2",
				cloudBaseMcpVersion: CLOUDBASE_MCP_VERSION,
			});
		}

		return GitHubHandler.fetch(request, env, ctx);
	},
} satisfies ExportedHandler<DirectV2WorkerEnv>;

export default new OAuthProvider({
	apiHandler: directMcp,
	apiRoute: "/mcp",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: directDefaultHandler,
	tokenEndpoint: "/token",
});
