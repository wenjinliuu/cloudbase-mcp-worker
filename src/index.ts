import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { GitHubHandler } from "./github-handler";
import type { Props } from "./utils";

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "CloudBase MCP OAuth Test",
		version: "1.0.0",
	});

	async init() {
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
