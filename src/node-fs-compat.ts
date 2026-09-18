import fs from "node:fs";

/**
 * Cloudflare Workers currently rejects explicit { encoding: null } in some
 * node:fs paths, while Node.js treats null as "no text encoding / return
 * Buffer". CloudBase's Node auth stack uses that Node-compatible form.
 *
 * Normalize only encoding:null so the dependency sees standard Node behavior.
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

const fsAny = fs as any;

if (!fsAny.__cloudbaseEncodingCompatPatched) {
	const originalReadFile = fs.readFile.bind(fs);
	fsAny.readFile = function (
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
	fsAny.readFileSync = function (path: any, options?: any) {
		return originalReadFileSync(path, normalizeEncodingOptions(options));
	};

	if (fs.promises?.readFile) {
		const originalPromisesReadFile = fs.promises.readFile.bind(fs.promises);
		(fs.promises as any).readFile = function (path: any, options?: any) {
			return originalPromisesReadFile(path, normalizeEncodingOptions(options));
		};
	}

	fsAny.__cloudbaseEncodingCompatPatched = true;
}
