// The package publishes declarations only for its root export.
// @ts-expect-error -- runtime deep import intentionally bypasses the aliased root.
import CloudBase from "../../node_modules/@cloudbase/manager-node/lib/index.js";

// CloudBase MCP's ESM bundle imports manager-node as a namespace and then
// applies TypeScript's __importDefault helper a second time. Mark this wrapper
// as an ES module and expose the constructor as default so that operation is
// idempotent in Workers.
export const __esModule = true;
export default CloudBase;
