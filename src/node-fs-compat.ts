import { createRequire, syncBuiltinESMExports } from "node:module";

/**
 * Cloudflare Workers exposes ESM builtin modules as immutable namespace
 * objects, so assigning to an imported `node:fs` namespace fails validation.
 *
 * Load the CommonJS-style builtin object through createRequire(), patch that
 * mutable object, then sync the builtin ESM exports. We only normalize the
 * Node-compatible `encoding: null` form to "encoding omitted".
 */
function normalizeEncodingOptions<T>(options: T): T {
	if (
		options &&
		typeof options === "object" &&
		"encoding" in (options as Record<string, unknown>) &&
		(options as Record<string, unknown>).encoding === null
	) {
		const copy = { ...(options as Record<string, unknown>) };
		delete copy.encoding;
		return copy as T;
	}
	return options;
}

const require = createRequire("/worker.js");
const fs = require("node:fs") as any;

if (!fs.__cloudbaseEncodingCompatPatched) {
	const originalReadFile = fs.readFile.bind(fs);
	fs.readFile = function (
		path: any,
		optionsOrCallback: any,
		maybeCallback?: any,
	) {
		if (typeof optionsOrCallback === "function") {
			return originalReadFile(path, optionsOrCallback);
		}
		return originalReadFile(
			path,
			normalizeEncodingOptions(optionsOrCallback),
			maybeCallback,
		);
	};

	const originalReadFileSync = fs.readFileSync.bind(fs);
	fs.readFileSync = function (path: any, options?: any) {
		return originalReadFileSync(path, normalizeEncodingOptions(options));
	};

	if (fs.promises?.readFile) {
		const originalPromisesReadFile = fs.promises.readFile.bind(fs.promises);
		fs.promises.readFile = function (path: any, options?: any) {
			return originalPromisesReadFile(
				path,
				normalizeEncodingOptions(options),
			);
		};
	}

	fs.__cloudbaseEncodingCompatPatched = true;

	// Keep ESM named exports in sync when the runtime implements this Node API.
	try {
		syncBuiltinESMExports();
	} catch {
		// Some Workers compatibility layers may not need/support syncing.
	}
}
