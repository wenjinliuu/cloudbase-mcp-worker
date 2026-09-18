import * as nodeFs from "node:fs";

/**
 * Worker-safe replacement for graceful-fs.
 *
 * graceful-fs intentionally forwards `null` for several optional fs arguments
 * (for example writeFile(..., null, cb)). Node.js accepts those forms, while
 * Cloudflare Workers' node:fs compatibility layer currently rejects some of
 * them. Normalize only those optional null values and otherwise delegate to
 * the native Worker node:fs implementation.
 */

function normalizeOptions<T>(value: T): T | undefined {
	if (value === null) return undefined;

	if (
		value &&
		typeof value === "object" &&
		"encoding" in (value as Record<string, unknown>) &&
		(value as Record<string, unknown>).encoding === null
	) {
		const copy = { ...(value as Record<string, unknown>) };
		delete copy.encoding;
		return copy as T;
	}

	return value;
}

export function readFile(path: any, optionsOrCallback: any, maybeCallback?: any) {
	if (typeof optionsOrCallback === "function") {
		return (nodeFs.readFile as any)(path, optionsOrCallback);
	}
	return (nodeFs.readFile as any)(
		path,
		normalizeOptions(optionsOrCallback),
		maybeCallback,
	);
}

export function writeFile(
	path: any,
	data: any,
	optionsOrCallback: any,
	maybeCallback?: any,
) {
	if (typeof optionsOrCallback === "function") {
		return (nodeFs.writeFile as any)(path, data, optionsOrCallback);
	}
	return (nodeFs.writeFile as any)(
		path,
		data,
		normalizeOptions(optionsOrCallback),
		maybeCallback,
	);
}

export function appendFile(
	path: any,
	data: any,
	optionsOrCallback: any,
	maybeCallback?: any,
) {
	if (typeof optionsOrCallback === "function") {
		return (nodeFs.appendFile as any)(path, data, optionsOrCallback);
	}
	return (nodeFs.appendFile as any)(
		path,
		data,
		normalizeOptions(optionsOrCallback),
		maybeCallback,
	);
}

export function readdir(path: any, optionsOrCallback: any, maybeCallback?: any) {
	if (typeof optionsOrCallback === "function") {
		return (nodeFs.readdir as any)(path, optionsOrCallback);
	}
	return (nodeFs.readdir as any)(
		path,
		normalizeOptions(optionsOrCallback),
		maybeCallback,
	);
}

export function open(
	path: any,
	flags: any,
	modeOrCallback: any,
	maybeCallback?: any,
) {
	if (typeof modeOrCallback === "function") {
		return (nodeFs.open as any)(path, flags, modeOrCallback);
	}
	return (nodeFs.open as any)(
		path,
		flags,
		modeOrCallback === null ? undefined : modeOrCallback,
		maybeCallback,
	);
}

export function readFileSync(path: any, options?: any) {
	return (nodeFs.readFileSync as any)(path, normalizeOptions(options));
}

export function writeFileSync(path: any, data: any, options?: any) {
	return (nodeFs.writeFileSync as any)(
		path,
		data,
		normalizeOptions(options),
	);
}

export function appendFileSync(path: any, data: any, options?: any) {
	return (nodeFs.appendFileSync as any)(
		path,
		data,
		normalizeOptions(options),
	);
}

export function readdirSync(path: any, options?: any) {
	return (nodeFs.readdirSync as any)(path, normalizeOptions(options));
}

export function openSync(path: any, flags: any, mode?: any) {
	return (nodeFs.openSync as any)(
		path,
		flags,
		mode === null ? undefined : mode,
	);
}

export function gracefulify<T>(target: T): T {
	return target;
}

export * from "node:fs";

const compat = {
	...nodeFs,
	readFile,
	writeFile,
	appendFile,
	readdir,
	open,
	readFileSync,
	writeFileSync,
	appendFileSync,
	readdirSync,
	openSync,
	gracefulify,
};

export default compat;
