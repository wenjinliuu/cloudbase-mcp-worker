import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { createCloudBaseMcpServer } from "@cloudbase/cloudbase-mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { GitHubHandler } from "./github-handler";
import type { Props } from "./utils";

type CloudBaseRuntimeEnv = Env & {
	CLOUDBASE_API_KEY?: string;
	CLOUDBASE_ENV_ID?: string;
	TCB_SITE?: string;
	TCB_LANG?: string;
};

async function probeEndpoint(url: string) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 5000);
	const startedAt = Date.now();

	try {
		const response = await fetch(url, {
			method: "GET",
			signal: controller.signal,
			redirect: "manual",
		});

		return {
			ok: true,
			status: response.status,
			durationMs: Date.now() - startedAt,
		};
	} catch (error) {
		return {
			ok: false,
			durationMs: Date.now() - startedAt,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		clearTimeout(timeout);
	}
}

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "CloudBase MCP",
		version: "1.0.0",
	});

	async init() {
		// CloudBase's official Node MCP reads credentials from process.env.
		// Copy Worker/Durable Object bindings explicitly so the package does not
		// depend on runtime-specific process.env auto-population behavior.
		const runtimeEnv = this.env as CloudBaseRuntimeEnv;
		if (runtimeEnv.CLOUDBASE_API_KEY) {
			process.env.CLOUDBASE_API_KEY = runtimeEnv.CLOUDBASE_API_KEY;
		}
		if (runtimeEnv.CLOUDBASE_ENV_ID) {
			process.env.CLOUDBASE_ENV_ID = runtimeEnv.CLOUDBASE_ENV_ID;
		}
		if (runtimeEnv.TCB_SITE) {
			process.env.TCB_SITE = runtimeEnv.TCB_SITE;
		}
		if (runtimeEnv.TCB_LANG) {
			process.env.TCB_LANG = runtimeEnv.TCB_LANG;
		}
		process.env.CLOUDBASE_MCP_CLOUD_MODE = "true";

		this.server.tool(
			"ping",
			"Verify that the authenticated ChatGPT connection can reach this private MCP server.",
			{},
			async () => ({
				content: [
					{
						type: "text",
						text: `pong — authenticated as GitHub user ${this.props!.login}`,
					},
				],
			}),
		);

		this.server.tool(
			"authenticatedUser",
			"Return the GitHub account that authenticated this private MCP connection.",
			{},
			async () => ({
				content: [
					{
						type: "text",
						text: JSON.stringify({
							login: this.props!.login,
							name: this.props!.name,
							email: this.props!.email,
						}),
					},
				],
			}),
		);

		this.server.tool(
			"cloudbaseRuntimeProbe",
			"Read-only diagnostic for CloudBase Worker runtime bindings and Tencent endpoint reachability. Never returns secret values.",
			{},
			async () => {
				const [domesticApi, authApi] = await Promise.all([
					probeEndpoint("https://tcb-api.tencentcloudapi.com"),
					probeEndpoint("https://tcb-api.tencentcloud.com"),
				]);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								apiKeyPresent: Boolean(process.env.CLOUDBASE_API_KEY),
								envId: process.env.CLOUDBASE_ENV_ID ?? null,
								site: process.env.TCB_SITE ?? null,
								lang: process.env.TCB_LANG ?? null,
								cloudMode: process.env.CLOUDBASE_MCP_CLOUD_MODE ?? null,
								endpoints: {
									tcbApiTencentcloudapiCom: domesticApi,
									tcbApiTencentcloudCom: authApi,
								},
							}),
						},
					],
				};
			},
		);

		const cloudBaseServer = await createCloudBaseMcpServer({
			name: "Tencent CloudBase",
			version: "2.34.4",
			enableTelemetry: false,
			cloudMode: true,
			lang: "zh",
		});

		for (const tool of cloudBaseServer.toolDefs) {
			this.server.registerTool(
				tool.name,
				{
					description: tool.description,
					inputSchema: tool.inputSchema,
				},
				async (args) => tool.handler(args),
			);
		}
	}
}

export default new OAuthProvider({
	apiHandler: MyMCP.serve("/mcp"),
	apiRoute: "/mcp",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: GitHubHandler as any,
	tokenEndpoint: "/token",
});
