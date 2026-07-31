import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  type NERConfig,
  type AnonymizationPolicy,
  PIIType,
  mergePolicy,
  generateKey,
  uint8ArrayToBase64,
  ConfigKeyProvider,
  InMemoryPIIStorageProvider,
  isModelDownloaded,
  downloadModel,
  type DownloadProgressCallback,
} from "../../index.js";
import { SECRET_PII_TYPES } from "../../types/pii-types.js";
import {
  createRehydraProxy,
  incomingMessageToRequest,
  writeResponse,
} from "../../proxy/index.js";
import type { RehydraProxyConfig, AnonymizeInfo } from "../../proxy/types.js";
import type { ParsedOptions } from "../main.js";
import { CLIError } from "../utils/errors.js";
import { bold, dim, cyan, green, yellow } from "../utils/color.js";
import { formatProgress, writeProgress, clearProgress } from "../utils/progress.js";
import { buildTagFormatFromOptions } from "../utils/tag-format.js";

const PROVIDER_UPSTREAMS: Record<string, string> = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  claude: "https://api.anthropic.com",
};

const PROVIDER_CANONICAL: Record<string, "openai" | "anthropic"> = {
  openai: "openai",
  anthropic: "anthropic",
  claude: "anthropic",
};

function getConnectionHints(
  provider: "openai" | "anthropic",
  baseUrl: string,
  upstream: URL,
  hasApiKey: boolean,
): string {
  const lines: string[] = [];

  if (provider === "anthropic") {
    if (hasApiKey) {
      lines.push(
        `  ${bold("Claude Code")}`,
        `    ANTHROPIC_BASE_URL=${baseUrl} claude`,
      );
    } else {
      lines.push(
        `  ${bold("Claude Code")} ${dim("(requires --api-key)")}`,
        `    ANTHROPIC_BASE_URL=${baseUrl} claude`,
      );
    }
    lines.push(
      "",
      `  ${bold("Cursor")}`,
      `    Settings ${dim("→")} Models ${dim("→")} Anthropic ${dim("→")} Override Base URL`,
      `    ${dim(baseUrl)}`,
    );
  } else {
    const upstreamPathSegments = upstream.pathname.split("/").filter(Boolean);
    const openAIBaseUrl =
      upstreamPathSegments.at(-1) === "v1" ? baseUrl : `${baseUrl}/v1`;

    lines.push(
      `  ${bold("Environment variable")}`,
      `    export OPENAI_BASE_URL=${openAIBaseUrl}`,
      "",
      `  ${bold("Cursor")}`,
      `    Settings ${dim("→")} Models ${dim("→")} OpenAI ${dim("→")} Override Base URL`,
      `    ${dim(openAIBaseUrl)}`,
      "",
      `  ${bold("OpenAI SDK")}`,
      `    ${dim(`new OpenAI({ baseURL: "${openAIBaseUrl}" })`)}`,
    );
  }

  return lines.join("\n");
}

export async function proxyCommand(
  provider: string | undefined,
  options: ParsedOptions,
): Promise<number> {
  if (provider === undefined) {
    throw new CLIError(
      "Missing provider argument.\n\n" +
        "Usage: rehydra proxy <provider>\n\n" +
        "Providers:\n" +
        "  openai       OpenAI API\n" +
        "  anthropic    Anthropic API\n" +
        "  claude       Alias for anthropic",
    );
  }

  const providerLower = provider.toLowerCase();
  const canonical = PROVIDER_CANONICAL[providerLower];

  if (canonical === undefined) {
    throw new CLIError(
      `Unknown provider: ${provider}\nSupported: openai, anthropic, claude`,
    );
  }

  const upstream = options.upstream ?? PROVIDER_UPSTREAMS[providerLower]!;
  const parsedUpstream = validateUpstream(upstream);
  const port = parseInt(options.port ?? "8787", 10);
  const host = "127.0.0.1";

  if (isNaN(port) || port < 1 || port > 65535) {
    throw new CLIError(`Invalid port: ${options.port}`);
  }

  // Key setup
  const envKey = process.env["REHYDRA_KEY"];
  const flagKey = options.key;
  const externalKey = flagKey ?? envKey;

  let keyProvider: ConfigKeyProvider;
  if (externalKey !== undefined) {
    keyProvider = new ConfigKeyProvider(externalKey);
  } else {
    const keyBytes = generateKey();
    keyProvider = new ConfigKeyProvider(uint8ArrayToBase64(keyBytes));
  }

  const storage = new InMemoryPIIStorageProvider();
  const nerMode = validateNerMode(options.ner);

  // Policy
  let policy: Partial<AnonymizationPolicy> | undefined;
  if (options.types !== undefined) {
    const enabledTypes = parseTypes(options.types);
    const policyPartial: Partial<AnonymizationPolicy> = { enabledTypes };
    if (options.secrets) {
      const regexEnabledTypes = new Set(enabledTypes);
      for (const t of SECRET_PII_TYPES) {
        enabledTypes.add(t);
        regexEnabledTypes.add(t);
      }
      policyPartial.regexEnabledTypes = regexEnabledTypes;
    }
    policy = mergePolicy(policyPartial);
  }

  // LLM API key — from --api-key flag or LLM_API_KEY env var
  const llmApiKey = options["api-key"] ?? process.env["LLM_API_KEY"];

  // Overlaps already reported, so each distinct one is only warned about once.
  // Bounded by the upstream path depth — the library always reports a suffix of it.
  const shownPathOverlaps = new Set<string>();

  // Build shared proxy config (without NER initially)
  const baseProxyConfig: RehydraProxyConfig = {
    upstream,
    provider: canonical,
    keyProvider,
    piiStorageProvider: storage,
    anonymizer: {
      ...(options.secrets ? { secrets: { enabled: true } } : {}),
      tagFormat: buildTagFormatFromOptions(options),
    },
    policy,
    locale: options.locale,
    apiKey: llmApiKey,

    // Warn about overlapping paths without exposing request paths or queries
    ...(!options.quiet
      ? {
          onPathOverlapWarning: (warning): void => {
            const duplicated = "/" + warning.overlappingSegments.join("/");

            if (shownPathOverlaps.has(duplicated)) return;
            shownPathOverlaps.add(duplicated);

            process.stderr.write(
              yellow(
                `Warning: Upstream and incoming request path overlap on ${duplicated}; forwarding to ${warning.upstreamBaseUrl}${duplicated}/...\nTo fix, remove it from --upstream or the client base URL.\n`,
              ),
            );
          },
        }
      : {}),

    // With --verbose, log per-request anonymization to stderr (never raw PII)
    ...(options.verbose && !options.quiet
      ? {
          onAnonymize: (info: AnonymizeInfo): void => {
            process.stderr.write(formatAnonymizeLog(info));
          },
        }
      : {}),
  };

  // Start with regex-only proxy (instant startup)
  let handler = createRehydraProxy(baseProxyConfig);

  // Create HTTP server with swappable handler
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async (): Promise<void> => {
      try {
        const webRequest = incomingMessageToRequest(req, host, port);
        const webResponse = await handler(webRequest);
        await writeResponse(res, webResponse);
      } catch (error) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "proxy_error",
          message: error instanceof Error ? error.message : "Unknown proxy error",
        }));
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      resolve();
    });
  });

  // Print startup banner
  const baseUrl = `http://${host}:${port}`;
  const nerEnabled = nerMode !== "disabled";
  let linesAfterNer = 0;

  if (!options.quiet) {
    const nerLine = `  NER        ${nerEnabled ? yellow("loading...") : dim("disabled")}`;

    const bannerBottom = [
      ...(llmApiKey !== undefined ? [`  API key    ${green("configured")}`] : []),
      ...(options.secrets ? [`  Secrets    ${green("enabled")}`] : []),
      "",
      `  ${bold("Configure your tools:")}`,
      "",
      getConnectionHints(
        canonical,
        baseUrl,
        parsedUpstream,
        llmApiKey !== undefined,
      ),
      "",
      `  ${dim("Ctrl+C to stop")}`,
      "",
    ];

    const banner = [
      "",
      `  ${bold("rehydra proxy")}`,
      "",
      `  Provider   ${cyan(canonical)} ${dim(`(${upstream})`)}`,
      `  Listening  ${green(baseUrl)}`,
      nerLine,
      ...bannerBottom,
    ].join("\n");

    process.stderr.write(banner);

    // Count lines after NER line for in-place cursor update
    linesAfterNer = bannerBottom.join("\n").split("\n").length;
  }

  // Helper to update the NER status line in-place
  const updateNerLine = (text: string): void => {
    if (options.quiet) return;
    if (process.stderr.isTTY && linesAfterNer > 0) {
      process.stderr.write(
        `\x1b[${linesAfterNer}A\x1b[2K\r${text}\x1b[${linesAfterNer}B\r`,
      );
    }
  };

  // Background: download and warm up NER model, then swap handler
  if (nerEnabled) {
    void loadNerAndSwap(nerMode, options, baseProxyConfig).then((nerProxy) => {
      if (nerProxy !== null) {
        handler = nerProxy;
        updateNerLine(`  NER        ${green(nerMode)}`);
      } else {
        updateNerLine(`  NER        ${yellow("failed")} ${dim("(regex-only)")}`);
      }
    });
  }

  // Wait for shutdown signal
  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      if (!options.quiet) {
        process.stderr.write(dim("\nShutting down...\n"));
      }
      resolve();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err !== undefined) reject(err);
      else resolve();
    });
  });

  return 0;
}

/**
 * Downloads the NER model (if needed), creates a NER-enabled proxy, and returns it.
 * Returns null on failure (proxy continues with regex-only).
 */
async function loadNerAndSwap(
  nerMode: NERConfig["mode"],
  options: ParsedOptions,
  baseConfig: RehydraProxyConfig,
): Promise<ReturnType<typeof createRehydraProxy> | null> {
  const modelMode = nerMode === "standard" ? "standard" : "quantized";

  try {
    // Download model if not cached
    const alreadyDownloaded = await isModelDownloaded(modelMode);
    if (!alreadyDownloaded) {
      if (!options.quiet) {
        process.stderr.write(`  ${dim(`Downloading NER model (${modelMode})...`)}\n`);
      }
      const onProgress: DownloadProgressCallback = (progress) => {
        if (!options.quiet) {
          writeProgress(formatProgress(progress.file, progress.percent));
        }
      };
      await downloadModel(modelMode, onProgress);
      clearProgress();
    }

    // Create NER-enabled proxy
    const nerProxy = createRehydraProxy({
      ...baseConfig,
      anonymizer: {
        ...baseConfig.anonymizer,
        ner: {
          mode: nerMode,
          autoDownload: false, // already downloaded
        },
      },
    });

    return nerProxy;
  } catch {
    return null;
  }
}

// --- helpers ---

function validateUpstream(value: string): URL {
  const error = (): CLIError =>
    new CLIError(
      `Invalid --upstream "${value}": expected an absolute http:// or https:// URL`,
    );

  if (!/^https?:\/\//i.test(value)) {
    throw error();
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw error();
  }

  // Reject upstream URL's with search params or hash fragments, since they won't create a valid base URL for the proxy forwarding
  if (/[?#]/.test(parsed.href)) {
    throw new CLIError(
      `Invalid --upstream "${value}": must not include query parameters or hash fragment`,
    );
  }

  return parsed;
}

/**
 * Format a one-line stderr log for a single intercepted request, e.g.
 *   POST /v1/chat/completions → anonymized 1 EMAIL, 1 PERSON
 * Reports types and counts only — never the raw PII values.
 */
function formatAnonymizeLog(info: AnonymizeInfo): string {
  let path: string;
  try {
    path = new URL(info.url).pathname;
  } catch {
    path = info.url;
  }

  const prefix = `  ${cyan(info.method)} ${path} ${dim("→")} `;

  if (info.totalEntities === 0) {
    return prefix + dim("no PII detected") + "\n";
  }

  const parts = Object.entries(info.countsByType)
    .map(([type, count]) => `${count} ${type}`)
    .join(", ");
  return prefix + green(`anonymized ${parts}`) + "\n";
}

function validateNerMode(mode: string): NERConfig["mode"] {
  const valid = ["disabled", "quantized", "standard"];
  if (!valid.includes(mode)) {
    throw new CLIError(
      `Invalid NER mode: ${mode}\nValid modes: ${valid.join(", ")}`,
    );
  }
  return mode as NERConfig["mode"];
}

function parseTypes(typesStr: string): Set<PIIType> {
  const allValues = new Set(Object.values(PIIType) as string[]);
  const types = new Set<PIIType>();

  for (const raw of typesStr.split(",")) {
    const t = raw.trim().toUpperCase();
    if (t === "") continue;
    if (!allValues.has(t)) {
      throw new CLIError(
        `Unknown PII type: ${raw.trim()}\nValid types: ${[...allValues].join(", ")}`,
      );
    }
    types.add(t as PIIType);
  }

  if (types.size === 0) {
    throw new CLIError("--types must specify at least one PII type");
  }

  return types;
}
