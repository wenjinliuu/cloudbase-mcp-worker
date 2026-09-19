/**
 * Shared Cloudflare bindings used by the GitHub OAuth gateway.
 *
 * This file augments both global Env shapes emitted by Wrangler. Keeping these
 * bindings separate from the generated worker-configuration.d.ts prevents a
 * future `wrangler types` run from deleting the declarations.
 */
interface Env {
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	COOKIE_ENCRYPTION_KEY: string;
	OAUTH_KV: KVNamespace;
}

declare namespace Cloudflare {
	interface Env {
		GITHUB_CLIENT_ID: string;
		GITHUB_CLIENT_SECRET: string;
		COOKIE_ENCRYPTION_KEY: string;
		OAUTH_KV: KVNamespace;
	}
}
