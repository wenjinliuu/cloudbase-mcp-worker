import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";

type TestEnv = Env & {
	CLOUDBASE_API_KEY?: string;
	CLOUDBASE_ENV_ID?: string;
};

const HOSTED_ORIGIN = "https://tcb-api.cloud.tencent.com";
const HOSTED_MCP = `${HOSTED_ORIGIN}/mcp/v1`;
const PROTOCOL_VERSION = "2025-06-18";
const CHATGPT_CALLBACK = "https://chatgpt.com/connector/oauth/9Mi_w2UV_djV";

function base64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

async function createPkcePair() {
	const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
	const verifier = base64Url(verifierBytes);
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(verifier),
	);
	return {
		verifier,
		challenge: base64Url(new Uint8Array(digest)),
	};
}

async function readResponse(response: Response) {
	const text = await response.text();
	let json: any = null;
	try {
		json = JSON.parse(text);
	} catch {
		// Keep non-JSON body as text only.
	}
	return {
		status: response.status,
		text,
		json,
		location: response.headers.get("location"),
	};
}

function sanitizedSnippet(value: string): string {
	return value
		.replace(
			/"(secretId|secretKey|token|sessionToken|apiKey|api_key|access_token|refresh_token)"\s*:\s*"[^"]*"/gi,
			'"$1":"[redacted]"',
		)
		.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
		.replace(/eyJ[A-Za-z0-9._~-]{20,}/g, "[redacted-token]")
		.slice(0, 3000);
}

async function getHostedAccessToken(
	env: TestEnv,
): Promise<{ accessToken: string; stageDurations: Record<string, number> }> {
	const apiKey = env.CLOUDBASE_API_KEY;
	const envId = env.CLOUDBASE_ENV_ID;
	if (!apiKey || !envId) {
		throw new Error("Missing CLOUDBASE_API_KEY or CLOUDBASE_ENV_ID.");
	}

	const durations: Record<string, number> = {};
	const pkce = await createPkcePair();
	const redirectUri = "http://127.0.0.1:8765/callback";

	let startedAt = Date.now();
	const register = await readResponse(
		await fetch(`${HOSTED_ORIGIN}/mcp/oauth2/register`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({
				client_name: "cloudbase-hosted-worker-test",
				redirect_uris: [redirectUri],
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
				token_endpoint_auth_method: "none",
			}),
		}),
	);
	durations.registerMs = Date.now() - startedAt;

	const clientId = register.json?.client_id;
	if (register.status !== 201 || !clientId) {
		throw new Error(
			`Hosted OAuth register failed: ${register.status} ${sanitizedSnippet(register.text)}`,
		);
	}

	startedAt = Date.now();
	const authorizeUrl = new URL(`${HOSTED_ORIGIN}/mcp/oauth2/authorize`);
	authorizeUrl.search = new URLSearchParams({
		response_type: "code",
		client_id: clientId,
		redirect_uri: redirectUri,
		code_challenge: pkce.challenge,
		code_challenge_method: "S256",
		scope: "mcp:full",
		state: "worker-test",
	}).toString();

	const authorize = await readResponse(
		await fetch(authorizeUrl.toString(), {
			method: "GET",
			redirect: "manual",
		}),
	);
	durations.authorizeMs = Date.now() - startedAt;

	const authorizeLocation = authorize.location;
	if (!authorizeLocation) {
		throw new Error(
			`Hosted OAuth authorize missing Location: ${authorize.status} ${sanitizedSnippet(authorize.text)}`,
		);
	}

	const sessionId = new URL(authorizeLocation).searchParams.get("session_id");
	if (!sessionId) {
		throw new Error(
			`Hosted OAuth authorize missing session_id: ${sanitizedSnippet(authorizeLocation)}`,
		);
	}

	startedAt = Date.now();
	const verify = await readResponse(
		await fetch(`${HOSTED_ORIGIN}/mcp/oauth2/authorize/apikey`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({
				session_id: sessionId,
				env_id: envId,
				api_key: apiKey,
			}),
		}),
	);
	durations.apiKeyVerifyMs = Date.now() - startedAt;

	if (verify.status !== 200 && verify.status !== 201) {
		throw new Error(
			`Hosted OAuth API-key verify failed: ${verify.status} ${sanitizedSnippet(verify.text)}`,
		);
	}

	startedAt = Date.now();
	const consent = await readResponse(
		await fetch(`${HOSTED_ORIGIN}/mcp/oauth2/authorize/consent`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({
				session_id: sessionId,
				env_id: envId,
			}),
			redirect: "manual",
		}),
	);
	durations.consentMs = Date.now() - startedAt;

	let code: string | null = consent.json?.code ?? null;
	if (!code && consent.location) {
		try {
			code = new URL(consent.location).searchParams.get("code");
		} catch {
			// Fall through to structured error below.
		}
	}
	if (!code) {
		throw new Error(
			`Hosted OAuth consent missing code: ${consent.status} ${sanitizedSnippet(consent.text)}`,
		);
	}

	startedAt = Date.now();
	const tokenResponse = await readResponse(
		await fetch(`${HOSTED_ORIGIN}/mcp/oauth2/token`, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code,
				client_id: clientId,
				redirect_uri: redirectUri,
				code_verifier: pkce.verifier,
			}).toString(),
		}),
	);
	durations.tokenMs = Date.now() - startedAt;

	const accessToken = tokenResponse.json?.access_token;
	if (tokenResponse.status !== 200 || !accessToken) {
		throw new Error(
			`Hosted OAuth token exchange failed: ${tokenResponse.status} ${sanitizedSnippet(tokenResponse.text)}`,
		);
	}

	return { accessToken, stageDurations: durations };
}

async function withHostedClient<T>(
	env: TestEnv,
	fn: (client: Client) => Promise<T>,
): Promise<{ result: T; authDurations: Record<string, number> }> {
	const envId = env.CLOUDBASE_ENV_ID;
	if (!envId) {
		throw new Error("Missing CLOUDBASE_ENV_ID.");
	}

	const { accessToken, stageDurations } = await getHostedAccessToken(env);

	const url = new URL(HOSTED_MCP);
	url.searchParams.set("env_id", envId);

	const transport = new StreamableHTTPClientTransport(url, {
		requestInit: {
			headers: {
				Authorization: `Bearer ${accessToken}`,
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
		return {
			result: await fn(client),
			authDurations: stageDurations,
		};
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
		return { message: sanitizedSnippet(String(error)) };
	}
	return {
		name: error.name,
		message: sanitizedSnippet(error.message),
		stack: error.stack
			? sanitizedSnippet(error.stack).slice(0, 4000)
			: null,
	};
}

export class HostedMCPTest extends McpAgent<TestEnv> {
	server = new McpServer({
		name: "CloudBase Hosted MCP Test",
		version: "1.1.0",
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
			"registerChatGPTOAuthClient",
			"Registers a public OAuth client with Tencent Hosted MCP for this ChatGPT connector callback. Returns only non-secret client metadata.",
			{},
			async () => {
				const startedAt = Date.now();
				try {
					const response = await readResponse(
						await fetch(`${HOSTED_ORIGIN}/mcp/oauth2/register`, {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								Accept: "application/json",
							},
							body: JSON.stringify({
								client_name: "ChatGPT CloudBase Direct OAuth Test",
								redirect_uris: [CHATGPT_CALLBACK],
								grant_types: ["authorization_code", "refresh_token"],
								response_types: ["code"],
								token_endpoint_auth_method: "none",
							}),
						}),
					);

					const clientId = response.json?.client_id;
					if (response.status !== 201 || !clientId) {
						throw new Error(
							`Hosted OAuth client registration failed: ${response.status} ${sanitizedSnippet(response.text)}`,
						);
					}

					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: true,
									stage: "chatgpt_oauth_client_register",
									durationMs: Date.now() - startedAt,
									clientId,
									redirectUri: CHATGPT_CALLBACK,
									tokenEndpointAuthMethod: "none",
									hasClientSecret: Boolean(response.json?.client_secret),
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
									stage: "chatgpt_oauth_client_register",
									durationMs: Date.now() - startedAt,
									error: safeError(error),
								}),
							},
						],
					};
				}
			},
		);

		this.server.tool(
			"hostedToolsProbe",
			"Read-only diagnostic. Uses the configured CloudBase API Key only to complete Tencent Hosted MCP OAuth, then returns the official Hosted MCP tool names/count.",
			{},
			async () => {
				const startedAt = Date.now();
				try {
					const { result, authDurations } = await withHostedClient(
						this.env,
						async (client) => {
							const listed = await client.listTools();
							return {
								count: listed.tools.length,
								names: listed.tools.map((tool) => tool.name),
							};
						},
					);

					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: true,
									stage: "hosted_tools_list_via_oauth",
									durationMs: Date.now() - startedAt,
									authDurations,
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
									stage: "hosted_tools_list_via_oauth",
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
			"Read-only diagnostic. Uses Tencent Hosted MCP OAuth and calls only queryEnv(action=info) for the configured environment.",
			{},
			async () => {
				const startedAt = Date.now();
				try {
					const { result, authDurations } = await withHostedClient(
						this.env,
						async (client) =>
							await client.callTool({
								name: "queryEnv",
								arguments: {
									action: "info",
									envId: this.env.CLOUDBASE_ENV_ID,
								},
							}),
					);

					const safePreview = sanitizedSnippet(JSON.stringify(result)).slice(
						0,
						8000,
					);

					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: true,
									stage: "hosted_queryEnv_info_via_oauth",
									durationMs: Date.now() - startedAt,
									authDurations,
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
									stage: "hosted_queryEnv_info_via_oauth",
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
