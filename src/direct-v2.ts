import {
	createCloudBaseManagerWithOptions,
	createCloudBaseMcpServer,
} from "@cloudbase/cloudbase-mcp";
import { exchangeApiKeyForCredential, type ApiKeyCredentialResult } from "@cloudbase/toolbox";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { constants as bufferConstants } from "node:buffer";
import { sanitizeDirectV2Response } from "./compat/mcp-response";
import { GitHubHandler } from "./github-handler";
import type { Props } from "./utils";

type DirectV2WorkerEnv = Env & {
	CLOUDBASE_API_KEY?: string;
	CLOUDBASE_ENV_ID?: string;
	CLOUDBASE_MCP_CLOUD_MODE?: string;
	CLOUDBASE_MCP_TELEMETRY_DISABLED?: string;
	TCB_LANG?: string;
	TCB_REGION?: string;
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
const CREDENTIAL_REFRESH_SKEW_MS = 2 * 60 * 1000;

let cachedCredential: ApiKeyCredentialResult | undefined;
let credentialExchange: Promise<ApiKeyCredentialResult> | undefined;
let cosBufferBindingCompatInstalled = false;
const hostingWebsiteConfigCompatPrototypes = new WeakSet<object>();

function assertBindings(env: DirectV2WorkerEnv): void {
	if (!env.CLOUDBASE_ENV_ID) {
		throw new Error("Missing CLOUDBASE_ENV_ID Worker binding.");
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
	if (!env.CLOUDBASE_API_KEY && !hasSecretId) {
		throw new Error("Configure CLOUDBASE_API_KEY or a complete Tencent Cloud credential pair.");
	}
}

function safeErrorMessage(error: unknown): string {
	if (!(error instanceof Error)) return "Unknown error";
	return error.message
		.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
		.replace(/eyJ[A-Za-z0-9._~-]{20,}/g, "[redacted-token]")
		.slice(0, 500);
}

function safeStorageError(error: unknown): string {
	if (error instanceof Error) return safeErrorMessage(error);
	if (!error || typeof error !== "object") return String(error).slice(0, 500);

	// cos-nodejs-sdk-v5 sometimes rejects with a plain object. The upstream MCP
	// currently turns that into "[object Object]", which hides the actionable
	// COS error code and RequestId. Keep only a strict, non-secret allowlist.
	const root = error as Record<string, unknown>;
	const nested =
		root.error && typeof root.error === "object"
			? (root.error as Record<string, unknown>)
			: undefined;
	const safe: Record<string, unknown> = {};
	const fields = [
		"code",
		"Code",
		"status",
		"statusCode",
		"message",
		"Message",
		"errorCode",
		"ErrorCode",
		"requestId",
		"RequestId",
		"resource",
		"Resource",
		"method",
		"Method",
	] as const;

	for (const field of fields) {
		const value = root[field] ?? nested?.[field];
		if (["string", "number", "boolean"].includes(typeof value)) {
			safe[field] = value;
		}
	}

	return JSON.stringify(
		Object.keys(safe).length > 0 ? safe : { type: Object.prototype.toString.call(error) },
	)
		.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
		.replace(/eyJ[A-Za-z0-9._~-]{20,}/g, "[redacted-token]")
		.slice(0, 800);
}

function ensureCosBufferBindingCompat(): void {
	if (cosBufferBindingCompatInstalled) return;

	const runtimeProcess = process as NodeJS.Process & {
		binding(name: string): unknown;
	};
	const originalBinding = runtimeProcess.binding.bind(runtimeProcess);
	try {
		const existing = originalBinding("buffer") as { kMaxLength?: number };
		if (typeof existing?.kMaxLength === "number") {
			cosBufferBindingCompatInstalled = true;
			return;
		}
	} catch (error) {
		const code =
			error && typeof error === "object" && "code" in error
				? String((error as { code?: unknown }).code)
				: "";
		if (code && code !== "ERR_METHOD_NOT_IMPLEMENTED") throw error;
	}

	// cos-nodejs-sdk-v5 uses this one legacy internal binding only to reject
	// impossibly large response bodies. Workers exposes the same values through
	// the public node:buffer API, so adapt just this binding and delegate all
	// other names to the runtime unchanged.
	const compatibleBinding = (name: string) => {
		if (name === "buffer") {
			return {
				kMaxLength: bufferConstants.MAX_LENGTH,
				kStringMaxLength: bufferConstants.MAX_STRING_LENGTH,
			};
		}
		return originalBinding(name);
	};

	Object.defineProperty(runtimeProcess, "binding", {
		configurable: true,
		writable: true,
		value: compatibleBinding,
	});
	cosBufferBindingCompatInstalled = true;
}

function ensureHostingWebsiteConfigCompat(
	manager: ReturnType<typeof createCloudBaseManagerWithOptions>,
): void {
	const hosting = manager.hosting as unknown as {
		getWebsiteConfig(): Promise<unknown>;
	};
	const prototype = Object.getPrototypeOf(hosting) as {
		getWebsiteConfig(): Promise<unknown>;
	};
	if (hostingWebsiteConfigCompatPrototypes.has(prototype)) return;

	const originalGetWebsiteConfig = prototype.getWebsiteConfig;
	prototype.getWebsiteConfig = async function () {
		try {
			ensureCosBufferBindingCompat();
			return await originalGetWebsiteConfig.call(this);
		} catch (error) {
			throw new Error(`HOSTING_WEBSITE_CONFIG_FAILED ${safeStorageError(error)}`);
		}
	};
	hostingWebsiteConfigCompatPrototypes.add(prototype);
}

async function getCloudBaseOptions(env: DirectV2WorkerEnv) {
	const envId = env.CLOUDBASE_ENV_ID!;
	const region = env.TCB_REGION || "ap-shanghai";

	// Direct Tencent Cloud credentials are supported for emergency rollback or
	// environments that do not use a CloudBase API Key.
	if (env.TENCENTCLOUD_SECRETID && env.TENCENTCLOUD_SECRETKEY) {
		return {
			envId,
			region,
			secretId: env.TENCENTCLOUD_SECRETID,
			secretKey: env.TENCENTCLOUD_SECRETKEY,
			token: env.TENCENTCLOUD_SESSIONTOKEN,
		};
	}

	if (
		cachedCredential?.envId === envId &&
		cachedCredential.accessTokenExpired > Date.now() + CREDENTIAL_REFRESH_SKEW_MS
	) {
		return { ...cachedCredential, region };
	}

	// The upstream loginByApiKey flow persists credentials through lowdb. That
	// is appropriate for a desktop CLI, but not for a stateless Worker. Exchange
	// the API Key directly and inject the resulting STS credential into the MCP
	// server so manager-node never touches the local credential store.
	credentialExchange ??= exchangeApiKeyForCredential({
		apiKey: env.CLOUDBASE_API_KEY!,
		envId,
		region,
	});

	try {
		cachedCredential = await credentialExchange;
		return { ...cachedCredential, region };
	} finally {
		credentialExchange = undefined;
	}
}

async function handleDirectMcp(request: Request, env: DirectV2WorkerEnv): Promise<Response> {
	if (!["GET", "POST", "DELETE"].includes(request.method)) {
		return new Response("Method not allowed", {
			status: 405,
			headers: { Allow: "GET, POST, DELETE" },
		});
	}

	assertBindings(env);
	// COS SDK response parsing uses one legacy Node buffer binding for multiple
	// read paths (storage listing, hosting website config, and hosted file lists).
	// Install the narrow public-node:buffer adapter for every Direct V2 request
	// rather than relying on a previous queryStorage call in the same isolate.
	ensureCosBufferBindingCompat();
	const cloudBaseOptions = await getCloudBaseOptions(env);

	// A fresh server and transport per request is the MCP SDK's stateless Worker pattern.
	// JSON responses avoid holding an SSE connection open for ordinary ChatGPT calls.
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	const manager = createCloudBaseManagerWithOptions(cloudBaseOptions);
	ensureHostingWebsiteConfigCompat(manager);
	const server = await createCloudBaseMcpServer({
		name: "cloudbase-mcp-direct-v2",
		version: CLOUDBASE_MCP_VERSION,
		cloudMode: true,
		cloudBaseOptions,
		// The official package currently couples Cloud Mode tool filtering to its
		// telemetry wrapper. Keep the wrapper enabled, while the Wrangler binding
		// CLOUDBASE_MCP_TELEMETRY_DISABLED=true prevents telemetry transmission.
		enableTelemetry: true,
		client: "chatgpt",
		lang: env.TCB_LANG || "zh",
		pluginOptions: {
			storage: {
				// Preserve the official manager-node implementation, but adapt its
				// plain-object COS rejection into a safe Error so MCP diagnostics retain
				// the error code/status/RequestId instead of "[object Object]".
				listFiles: async ({ cloudPath }) => {
					try {
						ensureCosBufferBindingCompat();
						return await manager.storage.listDirectoryFiles(cloudPath);
					} catch (error) {
						throw new Error(`COS_LIST_FAILED ${safeStorageError(error)}`);
					}
				},
			},
		},
		// The official RAG plugin downloads a template and writes a home-directory
		// cache even in Cloud Mode. It is documentation search, not cloud management,
		// so exclude it on Workers until upstream makes it filesystem-free.
		pluginsDisabled: ["rag"],
	});

	await server.connect(transport);
	return sanitizeDirectV2Response(await transport.handleRequest(request));
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
			const managerCompatibilityProbe = createCloudBaseManagerWithOptions({
				envId: "compat-probe",
				secretId: "probe-secret-id",
				secretKey: "probe-secret-key",
				region: "ap-shanghai",
			});
			return Response.json({
				ok: true,
				variant: "cloudbase-mcp-direct-v2",
				cloudBaseMcpVersion: CLOUDBASE_MCP_VERSION,
				credentialMode: "stateless-api-key",
				cloudBaseMcpModuleFormat: "esm-manager-adapter",
				managerConstructor: managerCompatibilityProbe.constructor.name,
				storageDiagnostics: "cos-buffer-binding-v2",
				hostingDiagnostics: "website-config-cos-v1",
				responseSanitizer: "list-function-layers-v1",
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
