/**
 * ESM/CJS interop shim for @cloudbase/manager-node.
 *
 * The package publishes CommonJS via `module.exports = CloudBase`, while the
 * prebuilt CloudBase MCP bundle accesses it as `manager_node_1.default`.
 * Cloudflare Workers' bundling path can expose the CommonJS constructor without
 * that default wrapper, causing "manager_node_1.default is not a constructor".
 *
 * Import the package's concrete CommonJS entry by subpath, normalize the shape,
 * and expose a real ESM default export.
 */
import * as ManagerNamespace from "@cloudbase/manager-node/lib/index.js";

const CloudBase =
	(ManagerNamespace as any).default ??
	(ManagerNamespace as any);

export default CloudBase;
