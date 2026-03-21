/**
 * Rehydra Plugin Factory for OpenCode
 *
 * Creates an OpenCode plugin that pseudonymizes secrets in outbound LLM
 * requests and rehydrates them in responses, using the auth.loader hook
 * to provide a custom fetch wrapper.
 */

import { resolve } from "node:path";
import {
  InMemoryKeyProvider,
  InMemoryPIIStorageProvider,
} from "../index.js";
import { createRehydraFetch } from "../proxy/index.js";
import type { RehydraFetchConfig } from "../proxy/types.js";
import { resolveConfig } from "./config.js";
import type { RehydraPluginOptions } from "./types.js";

function mapProvider(
  provider: string,
): "openai" | "anthropic" | "auto" {
  if (provider === "anthropic") return "anthropic";
  if (provider === "openai") return "openai";
  return "auto";
}

/**
 * Creates an OpenCode plugin that intercepts LLM API requests,
 * pseudonymizes secrets, and rehydrates responses.
 *
 * @example
 * ```typescript
 * import { createRehydraPlugin } from "@rehydra/opencode";
 *
 * export default createRehydraPlugin({
 *   provider: "anthropic",
 *   envFiles: [".env", ".env.local"],
 * });
 * ```
 */
export function createRehydraPlugin(options: RehydraPluginOptions) {
  return async (input: { directory: string }): Promise<{
    auth: {
      provider: string;
      methods: Array<{
        type: string;
        label: string;
        authorize: (inputs?: Record<string, string>) => Promise<{ type: string; key?: string }>;
      }>;
      loader: (
        getAuth: () => Promise<unknown>,
      ) => Promise<{ fetch?: typeof globalThis.fetch }>;
    };
  }> => {
    const config = resolveConfig(options, input.directory);

    const fetchConfig: RehydraFetchConfig = {
      anonymizer: {
        secrets: {
          enabled: true,
          envFiles: config.envFiles?.map((f) =>
            f.startsWith("/") ? f : resolve(input.directory, f),
          ),
          redactValues: config.redactValues,
          minValueLength: config.minValueLength,
        },
      },
      keyProvider: new InMemoryKeyProvider(),
      piiStorageProvider: new InMemoryPIIStorageProvider(),
      provider: mapProvider(options.provider),
    };

    const rehydraFetch = createRehydraFetch(fetchConfig);

    return {
      auth: {
        provider: options.provider,
        methods: [
          {
            type: "api",
            label: `${options.provider} (Rehydra protected)`,
            async authorize(inputs) {
              const key = inputs?.apiKey;
              if (!key) return { type: "failed" };
              return { type: "success", key };
            },
          },
        ],
        async loader(getAuth) {
          const auth = await getAuth();
          if (!auth) return {};
          return { fetch: rehydraFetch };
        },
      },
    };
  };
}
