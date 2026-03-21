/**
 * Rehydra OpenCode Plugin
 *
 * Pseudonymizes secrets in LLM API requests and rehydrates responses.
 * Secrets never leave your machine.
 *
 * @example
 * ```json
 * // opencode.json
 * { "plugin": ["@rehydra/opencode"] }
 * ```
 *
 * @example
 * ```typescript
 * // Custom config: .opencode/plugins/rehydra.ts
 * import { createRehydraPlugin } from "@rehydra/opencode";
 * export default createRehydraPlugin({
 *   provider: "anthropic",
 *   envFiles: [".env", ".env.local"],
 * });
 * ```
 */

export { createRehydraPlugin } from "./create-plugin.js";
export type { RehydraPluginOptions } from "./types.js";

import { createRehydraPlugin } from "./create-plugin.js";

/** Pre-configured plugin for Anthropic */
export const RehydraAnthropicPlugin = createRehydraPlugin({
  provider: "anthropic",
});

/** Pre-configured plugin for OpenAI */
export const RehydraOpenAIPlugin = createRehydraPlugin({
  provider: "openai",
});

/** Default export: Anthropic plugin */
export default RehydraAnthropicPlugin;
