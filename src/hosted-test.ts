import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";

type TestEnv = Env & {
	CLOUDBASE_API_KEY?: string;
	CLOUDBASE_ENV_ID?: string;
};

const HOSTED_MCP = "https://tcb-api.cloud.tencent.com/mcp/v1";
const PROTOCOL_VERSION = "2025-06-18";

async function withHostedClient<T>(
	env: TestEnv,
	fn: (client: Client) => Promise<T>,
): Promise<T> {
	const apiKey = env.CLOUDBASE_API_KEY;
	const envId = env.CLOUDBASE_ENV_ID;

	if (!apiKey || !envId) {
		throw new Error("Missing CLOUDBASE_API_KEY or CLOUDBASE_ENV_ID.");
	}

	const url = new URL(HOSTED_MCP);
	url.searchParams.set("env_id", envId);

	const transport = new StreamableHTTPClientTransport(url, {
		requestInit: {
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
		},
	});

	const originalSend = transport.send.bind(transport);
	transport.send = async (message: any) => {
		if (
			message?.method === "initialize" &&
			message?.params &&
			typeof message.params === "object"
		) {
			message.params.protocolVersion = PROTOCOL_VERSION;
		}
		return originalSend(message);
	};

	const client = new Client(
		{ name: "cloudbase-hosted-mcp-test", version: "1.0.0" },
		{ capabilities: {} },
	);

	try {
		await client.connect(transport);
		return await fn(client);
	} finally {
		try {
			await client.close();
		} catch {
			// Ignore close errors in diagnostics.
		}
		try {
			await transport.close();
		} catch {
			// Ignore close errors in diagnostics.
		}
	}
}

function safeError(error: unknown) {
	if (!(error instanceof Error)) {
		return { message: String(error) };
	}
	return {
		name: error.name,
		message: error.message,
		stack: error.stack?.slice(0, 4000) ?? null,
	};
}

export class HostedMCPTest extends McpAgent<TestEnv> {
	server = new McpServer({
		name: "CloudBase Hosted MCP Test",
		version: "1.0.0",
	});

	async init() {
		this.server.tool(
			"ping",
			"Verify that the isolated hosted MCP test Worker is reachable.",
			{},
			async () => ({
				content: [{ type: "text", text: "pong — hosted MCP test worker" }],
			}),
		);

		this.server.tool(
			"hostedToolsProbe",
			"Read-only diagnostic. Connects to Tencent CloudBase Hosted MCP with the configured environment-scoped API key and returns only tool names/count.",
			{},
			async () => {
				const startedAt = Date.now();
				try {
					const result = await withHostedClient(this.env, async (client) => {
						const listed = await client.listTools();
						return {
							count: listed.tools.length,
							names: listed.tools.map((tool) => tool.name),
						};
					});

					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: true,
									stage: "hosted_tools_list",
									durationMs: Date.now() - startedAt,
									envId: this.env.CLOUDBASE_ENV_ID ?? null,
									...result,
								}),
							},
						],
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: false,
									stage: "hosted_tools_list",
									durationMs: Date.now() - startedAt,
									envId: this.env.CLOUDBASE_ENV_ID ?? null,
									error: safeError(error),
								}),
							},
						],
					};
				}
			},
		);

		this.server.tool(
			"hostedQueryEnvProbe",
			"Read-only diagnostic. Calls only the official CloudBase Hosted MCP queryEnv tool with action=info for the configured environment.",
			{},
			async () => {
				const startedAt = Date.now();
				try {
					const result = await withHostedClient(this.env, async (client) => {
						return await client.callTool({
							name: "queryEnv",
							arguments: {
								action: "info",
								envId: this.env.CLOUDBASE_ENV_ID,
							},
						});
					});

					const raw = JSON.stringify(result);
					const safePreview = raw
						.replace(
							/"(secretId|secretKey|token|sessionToken|apiKey)"\s*:\s*"[^"]*"/gi,
							'"$1":"[redacted]"',
						)
						.slice(0, 8000);

					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: true,
									stage: "hosted_queryEnv_info",
									durationMs: Date.now() - startedAt,
									envId: this.env.CLOUDBASE_ENV_ID ?? null,
									resultPreview: safePreview,
								}),
							},
						],
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: false,
									stage: "hosted_queryEnv_info",
									durationMs: Date.now() - startedAt,
									envId: this.env.CLOUDBASE_ENV_ID ?? null,
									error: safeError(error),
								}),
							},
						],
					};
				}
			},
		);
	}
}

export default HostedMCPTest.serve("/mcp");
