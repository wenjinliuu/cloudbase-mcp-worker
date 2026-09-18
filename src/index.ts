import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { createCloudBaseMcpServer } from "@cloudbase/cloudbase-mcp";
import { AuthSupervisor } from "@cloudbase/toolbox";
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
				const envId = process.env.CLOUDBASE_ENV_ID;
				const exchangeBase = envId
					? `https://${envId}.ap-shanghai.tcb-api.tencentcloudapi.com`
					: null;

				const [domesticApi, authApi, envExchangeRoot, envAuthCerts] =
					await Promise.all([
						probeEndpoint("https://tcb-api.tencentcloudapi.com"),
						probeEndpoint("https://tcb-api.tencentcloud.com"),
						exchangeBase
							? probeEndpoint(exchangeBase)
							: Promise.resolve(null),
						exchangeBase
							? probeEndpoint(`${exchangeBase}/auth/v1/certs`)
							: Promise.resolve(null),
					]);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								apiKeyPresent: Boolean(process.env.CLOUDBASE_API_KEY),
								envId: envId ?? null,
								site: process.env.TCB_SITE ?? null,
								lang: process.env.TCB_LANG ?? null,
								cloudMode: process.env.CLOUDBASE_MCP_CLOUD_MODE ?? null,
								endpoints: {
									tcbApiTencentcloudapiCom: domesticApi,
									tcbApiTencentcloudCom: authApi,
									envSpecificExchangeRoot: envExchangeRoot,
									envSpecificAuthCerts: envAuthCerts,
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

		const officialAuthTool = cloudBaseServer.toolDefs.find(
			(tool) => tool.name === "auth",
		);

		this.server.tool(
			"cloudbaseAuthProbe",
			"Read-only diagnostic for the official CloudBase API-key authentication exchange. It uses the configured Worker secret internally and never returns credential values.",
			{},
			async () => {
				if (!officialAuthTool) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: false,
									stage: "tool_lookup",
									error: "Official CloudBase auth tool not found.",
								}),
							},
						],
					};
				}

				const apiKey = process.env.CLOUDBASE_API_KEY;
				const envId = process.env.CLOUDBASE_ENV_ID;
				if (!apiKey || !envId) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: false,
									stage: "bindings",
									apiKeyPresent: Boolean(apiKey),
									envIdPresent: Boolean(envId),
								}),
							},
						],
					};
				}

				const startedAt = Date.now();
				let timer: ReturnType<typeof setTimeout> | undefined;
				try {
					const outcome = await Promise.race([
						officialAuthTool.handler({
							action: "login_by_api_key",
							apiKey,
							apiKeyEnvId: envId,
							site: process.env.TCB_SITE ?? "domestic",
							lang: process.env.TCB_LANG ?? "zh",
						}).then((result) => ({
							kind: "completed" as const,
							result,
						})),
						new Promise<{ kind: "timeout" }>((resolve) => {
							timer = setTimeout(
								() => resolve({ kind: "timeout" as const }),
								12000,
							);
						}),
					]);

					if (outcome.kind === "timeout") {
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify({
										ok: false,
										stage: "official_auth_login_by_api_key",
										outcome: "timeout",
										durationMs: Date.now() - startedAt,
										apiKeyPresent: true,
										envId,
										site: process.env.TCB_SITE ?? "domestic",
										note: "Official auth handler did not return within 12 seconds.",
									}),
								},
							],
						};
					}

					const authRaw = JSON.stringify(outcome.result);
					const authSafePreview = authRaw
						.replace(/"(secretId|secretKey|token|sessionToken|apiKey)"\\s*:\\s*"[^"]*"/gi, '"$1":"[redacted]"')
						.replace(/CloudBase API Key[^\\n]*/gi, "CloudBase API Key [redacted]")
						.slice(0, 6000);

					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: true,
									stage: "official_auth_login_by_api_key",
									outcome: "completed",
									durationMs: Date.now() - startedAt,
									apiKeyPresent: true,
									envId,
									site: process.env.TCB_SITE ?? "domestic",
									resultPreview: authSafePreview,
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
									stage: "official_auth_login_by_api_key",
									outcome: "error",
									durationMs: Date.now() - startedAt,
									error:
										error instanceof Error
											? error.message
											: String(error),
								}),
							},
						],
					};
				} finally {
					if (timer) clearTimeout(timer);
				}
			},
		);

		this.server.tool(
			"cloudbaseApiKeyExchangeProbe",
			"Read-only low-level diagnostic for CloudBase API-key exchange. Calls @cloudbase/toolbox AuthSupervisor directly with the configured secret and returns only sanitized success/error metadata.",
			{},
			async () => {
				const apiKey = process.env.CLOUDBASE_API_KEY;
				const envId = process.env.CLOUDBASE_ENV_ID;
				if (!apiKey || !envId) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: false,
									stage: "bindings",
									apiKeyPresent: Boolean(apiKey),
									envIdPresent: Boolean(envId),
								}),
							},
						],
					};
				}

				const startedAt = Date.now();
				let timer: ReturnType<typeof setTimeout> | undefined;

				try {
					const authSupervisor = AuthSupervisor.getInstance({});
					const outcome = await Promise.race([
						authSupervisor
							.loginByApiKey(apiKey, envId, { cwd: "/" })
							.then((credential: any) => ({
								kind: "completed" as const,
								credential,
							})),
						new Promise<{ kind: "timeout" }>((resolve) => {
							timer = setTimeout(
								() => resolve({ kind: "timeout" as const }),
								12000,
							);
						}),
					]);

					if (outcome.kind === "timeout") {
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify({
										ok: false,
										stage: "toolbox_loginByApiKey",
										outcome: "timeout",
										durationMs: Date.now() - startedAt,
										envId,
									}),
								},
							],
						};
					}

					const credential = outcome.credential ?? {};
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: true,
									stage: "toolbox_loginByApiKey",
									outcome: "completed",
									durationMs: Date.now() - startedAt,
									envId,
									credentialShape: {
										hasSecretId: Boolean(credential.secretId),
										hasSecretKey: Boolean(credential.secretKey),
										hasToken: Boolean(
											credential.token ?? credential.sessionToken,
										),
										returnedEnvId:
											typeof credential.envId === "string"
												? credential.envId
												: null,
										expireAt:
											credential.expireAt ??
											credential.expiredTime ??
											credential.expiration ??
											null,
									},
								}),
							},
						],
					};
				} catch (error: any) {
					const safeMeta: Record<string, unknown> = {};
					for (const key of [
						"code",
						"name",
						"status",
						"statusCode",
						"errno",
						"syscall",
						"hostname",
						"host",
					]) {
						const value = error?.[key];
						if (
							typeof value === "string" ||
							typeof value === "number" ||
							typeof value === "boolean"
						) {
							safeMeta[key] = value;
						}
					}

					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: false,
									stage: "toolbox_loginByApiKey",
									outcome: "error",
									durationMs: Date.now() - startedAt,
									envId,
									error: {
										message:
											error instanceof Error
												? error.message
												: String(error),
										...safeMeta,
										stack:
											error instanceof Error && error.stack
												? error.stack
														.replace(
															/(eyJ[a-zA-Z0-9._-]{20,})/g,
															"[redacted-token]",
														)
														.slice(0, 6000)
												: null,
									},
								}),
							},
						],
					};
				} finally {
					if (timer) clearTimeout(timer);
				}
			},
		);

		const officialCallCloudApiTool = cloudBaseServer.toolDefs.find(
			(tool) => tool.name === "callCloudApi",
		);

		this.server.tool(
			"cloudbaseControlPlaneProbe",
			"Read-only bounded diagnostic for the official CloudBase control-plane call path. Calls only tcb/DescribeEnvs for the configured environment and never modifies resources.",
			{},
			async () => {
				if (!officialCallCloudApiTool) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: false,
									stage: "tool_lookup",
									error: "Official CloudBase callCloudApi tool not found.",
								}),
							},
						],
					};
				}

				const envId = process.env.CLOUDBASE_ENV_ID;
				if (!envId) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: false,
									stage: "bindings",
									error: "CLOUDBASE_ENV_ID is missing.",
								}),
							},
						],
					};
				}

				const startedAt = Date.now();
				let timer: ReturnType<typeof setTimeout> | undefined;
				try {
					const outcome = await Promise.race([
						officialCallCloudApiTool
							.handler({
								service: "tcb",
								action: "DescribeEnvs",
								params: { EnvId: envId },
							})
							.then((result) => ({
								kind: "completed" as const,
								result,
							})),
						new Promise<{ kind: "timeout" }>((resolve) => {
							timer = setTimeout(
								() => resolve({ kind: "timeout" as const }),
								12000,
							);
						}),
					]);

					if (outcome.kind === "timeout") {
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify({
										ok: false,
										stage: "official_callCloudApi_DescribeEnvs",
										outcome: "timeout",
										durationMs: Date.now() - startedAt,
										envId,
										note: "Official callCloudApi handler did not return within 12 seconds.",
									}),
								},
							],
						};
					}

					const raw = JSON.stringify(outcome.result);
					const safePreview = raw
						.replace(/"(secretId|secretKey|token|sessionToken|apiKey)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')
						.slice(0, 6000);

					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									ok: true,
									stage: "official_callCloudApi_DescribeEnvs",
									outcome: "completed",
									durationMs: Date.now() - startedAt,
									envId,
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
									stage: "official_callCloudApi_DescribeEnvs",
									outcome: "error",
									durationMs: Date.now() - startedAt,
									error:
										error instanceof Error
											? error.message
											: String(error),
								}),
							},
						],
					};
				} finally {
					if (timer) clearTimeout(timer);
				}
			},
		);

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
