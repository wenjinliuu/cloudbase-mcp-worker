/**
 * Worker-safe replacement for the local browser launcher.
 *
 * CloudBase Cloud Mode authenticates with CLOUDBASE_API_KEY and must never start
 * an interactive browser flow inside a remote Worker.
 */
export default async function open(): Promise<never> {
	throw new Error(
		"Interactive browser authentication is unavailable in Cloudflare Workers; configure CLOUDBASE_API_KEY.",
	);
}
