/**
 * Server mode: anonymize and rehydrate as a service at a sandbox boundary.
 * Node.js/Bun/Deno only — not available in browser builds.
 */

export {
  createRehydraServer,
  type RehydraServer,
  type RehydraServerConfig,
  type ServerRequestInfo,
} from "./handler.js";
