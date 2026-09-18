import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { createCloudBaseMcpServer } from "@cloudbase/cloudbase-mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { GitHubHandler } from "./github-handler";
import type { Props } from "./utils";

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "CloudBase MCP",
		version: "1.0.0",
	});

	async init() {
		// Keep two small diagnostics so we can distinguish OAuth/Worker issues
		// from Tencent CloudBase authentication issues.
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

		// Tencent's official MCP package supports CloudBase environment-level
		// API keys via CLOUDBASE_API_KEY + CLOUDBASE_ENV_ID. Cloud mode disables
		// actions that require a local filesystem (local uploads/downloads/builds).
		const cloudBaseServer = await createCloudBaseMcpServer({
			name: "Tencent CloudBase",
			version: "2.34.4",
			enableTelemetry: false,
			cloudMode: true,
			lang: "zh",
		});

		// CloudBase intentionally exposes toolDefs so external MCP hosts can
		// re-register the official tools on their own transport/server.
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
