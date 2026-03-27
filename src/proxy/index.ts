/**
 * Proxy Middleware Module
 * Node.js/Bun only — not available in browser builds.
 */

export { createRehydraFetch } from "./rehydra-fetch.js";
export { createRehydraProxy } from "./rehydra-proxy.js";
export { wrapLLMClient } from "./wrap-client.js";
export {
  createRehydraProxyServer,
  incomingMessageToRequest,
  writeResponse,
  type RehydraProxyServerConfig,
  type RehydraProxyServer,
} from "./proxy-server.js";
export { SSEParser, isSSEDone, serializeSSEEvent, type SSEEvent } from "./sse-parser.js";
export {
  detectProvider,
  OpenAIProvider,
  AnthropicProvider,
  type LLMContentProvider,
} from "./providers/index.js";
export type { RehydraFetchConfig, RehydraProxyConfig, OnToolCallFn } from "./types.js";
export { DEFAULT_PII_SYSTEM_INSTRUCTION } from "./system-instruction.js";
