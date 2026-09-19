/**
 * Worker-safe replacement for yargs.
 *
 * @cloudbase/toolbox only reads `yargs.argv.mode` while loading optional local
 * .env files. Cloudflare Workers have no process CLI, so an empty argv object is
 * the correct cloud-mode representation.
 */
const yargs = {
	argv: Object.freeze({}) as Readonly<Record<string, string | undefined>>,
};

export default yargs;
