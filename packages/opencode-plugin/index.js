import { createRehydraPlugin } from "rehydra/opencode-plugin";

// Named export: the factory for custom config (.opencode/plugins/rehydra.ts)
export { createRehydraPlugin };

// Named + default export: the plugin function for opencode.json usage.
// OpenCode calls named exports as plugin functions, so this must be
// the Plugin itself (takes ctx, returns hooks), not the factory.
export const rehydra = createRehydraPlugin();
export default rehydra;
