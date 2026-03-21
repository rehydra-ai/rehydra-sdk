/**
 * @rehydra/opencode — OpenCode plugin for PII/secrets protection
 *
 * Re-exports from the main rehydra package.
 * Use in opencode.json: { "plugin": ["@rehydra/opencode"] }
 */

export {
  default,
  createRehydraPlugin,
  RehydraAnthropicPlugin,
  RehydraOpenAIPlugin,
} from "rehydra/opencode-plugin";
