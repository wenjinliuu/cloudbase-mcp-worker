/**
 * ESM/CJS interop shim for @cloudbase/manager-node.
 *
 * The package publishes CommonJS with `module.exports = CloudBase`, while the
 * prebuilt CloudBase MCP bundle accesses it as `manager_node_1.default`.
 * Workers can expose one or more interop wrappers around that CommonJS export.
 *
 * Export a guaranteed-constructable wrapper function as the ESM default, and
 * unwrap the real CloudBase constructor at runtime.
 */
import * as ManagerNamespace from "@cloudbase/manager-node/lib/index.js";

function resolveCloudBaseConstructor(root: any): any {
	const queue = [root];
	const seen = new Set<any>();

	while (queue.length > 0) {
		const value = queue.shift();
		if (!value || seen.has(value)) continue;
		seen.add(value);

		if (typeof value === "function") {
			return value;
		}

		if (typeof value === "object") {
			for (const key of ["default", "CloudBase", "module", "exports"]) {
				const nested = value[key];
				if (nested && !seen.has(nested)) queue.push(nested);
			}
		}
	}

	throw new TypeError(
		"Unable to resolve the @cloudbase/manager-node CloudBase constructor.",
	);
}

const ActualCloudBase = resolveCloudBaseConstructor(ManagerNamespace);

function CloudBaseCompat(this: any, config: any = {}) {
	return Reflect.construct(ActualCloudBase, [config]);
}

(CloudBaseCompat as any).init = (config: any = {}) => {
	if (typeof ActualCloudBase.init === "function") {
		return ActualCloudBase.init(config);
	}
	return Reflect.construct(ActualCloudBase, [config]);
};

// Preserve the real prototype for instanceof / method lookups where possible.
(CloudBaseCompat as any).prototype = ActualCloudBase.prototype;

export default CloudBaseCompat;
