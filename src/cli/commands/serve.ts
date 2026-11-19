import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import {
  type NERConfig,
  ConfigKeyProvider,
  InMemoryPIIStorageProvider,
  SQLitePIIStorageProvider,
  generateKey,
  uint8ArrayToBase64,
  type PIIStorageProvider,
} from "../../index.js";
import { incomingMessageToRequest, writeResponse } from "../../proxy/index.js";
import { createRehydraServer, type ServerRequestInfo } from "../../server/index.js";
import type { CredentialUseEvent } from "../../core/credentials.js";
import type { ParsedOptions } from "../main.js";
import { CLIError } from "../utils/errors.js";
import { bold, cyan, dim, green, yellow } from "../utils/color.js";
import { buildTagFormatFromOptions } from "../utils/tag-format.js";
import { loadCredentialsFile } from "../utils/credentials.js";

function validateNerMode(mode: string): NERConfig["mode"] {
  const valid = ["disabled", "quantized", "standard"];
  if (!valid.includes(mode)) {
    throw new CLIError(`Invalid NER mode: ${mode}\nValid modes: ${valid.join(", ")}`);
  }
  return mode as NERConfig["mode"];
}

function formatRequestLog(info: ServerRequestInfo): string {
  const counts = info.countsByType === undefined
    ? ""
    : Object.entries(info.countsByType).map(([type, count]) => ` ${count} ${type}`).join(",");
  const status = info.status >= 400 ? yellow(String(info.status)) : green(String(info.status));
  return `  ${cyan(info.method)} ${info.route} ${dim("→")} ${status}${counts}\n`;
}

function formatCredentialLog(event: CredentialUseEvent): string {
  if (event.restored) return `  ${dim("credential")} ${event.credential} ${dim("→")} filled in for ${event.tool}\n`;
  const reason = event.reason === "host-not-allowed" ? "host not allowed" : "tool not allowed";
  return yellow(`  credential ${event.credential} → kept placeholder for ${event.tool} (${reason})\n`);
}

/**
 * `rehydra serve`: anonymize and rehydrate as an HTTP service at a sandbox
 * boundary. Listens on loopback or a Unix socket and requires a bearer token.
 */
export async function serveCommand(options: ParsedOptions): Promise<number> {
  const port = parseInt(options.port ?? "8788", 10);
  if (options.socket === undefined && (isNaN(port) || port < 1 || port > 65535)) {
    throw new CLIError(`Invalid port: ${options.port}`);
  }

  const externalKey = options.key ?? process.env["REHYDRA_KEY"];
  if (options.db !== undefined && externalKey === undefined) {
    throw new CLIError(
      "--db stores encrypted PII maps across restarts, so it needs a fixed key.\n" +
        "Pass --key or set REHYDRA_KEY (generate one with: openssl rand -base64 32).",
    );
  }
  const keyProvider = new ConfigKeyProvider(externalKey ?? uint8ArrayToBase64(generateKey()));

  let storage: PIIStorageProvider;
  if (options.db !== undefined) {
    const sqlite = new SQLitePIIStorageProvider(options.db);
    await sqlite.initialize();
    storage = sqlite;
  } else {
    storage = new InMemoryPIIStorageProvider();
  }

  const givenToken = options.token ?? process.env["REHYDRA_SERVE_TOKEN"];
  const token = givenToken ?? randomBytes(24).toString("base64url");
  const credentials = options.credentials !== undefined ? await loadCredentialsFile(options.credentials) : undefined;
  const redactTools = options["redact-tools"]?.split(",").map((tool) => tool.trim()).filter((tool) => tool !== "");
  const log = (line: string): void => {
    if (!options.quiet) process.stderr.write(line);
  };

  let server;
  try {
    server = createRehydraServer({
      token,
      keyProvider,
      piiStorageProvider: storage,
      locale: options.locale,
      redactTools,
      anonymizer: {
        ner: { mode: validateNerMode(options.ner) },
        ...(options.secrets ? { secrets: { enabled: true } } : {}),
        tagFormat: buildTagFormatFromOptions(options),
        ...(credentials !== undefined
          ? { credentials, onCredentialUse: (event: CredentialUseEvent): void => log(formatCredentialLog(event)) }
          : {}),
      },
      ...(options.verbose ? { onRequest: (info: ServerRequestInfo): void => log(formatRequestLog(info)) } : {}),
    });
  } catch (error) {
    throw new CLIError(error instanceof Error ? error.message : String(error));
  }

  // Load the NER model and credentials before accepting requests.
  log(dim("  Loading...\n"));
  try {
    await server.initialize();
  } catch (error) {
    throw new CLIError(`Could not start: ${error instanceof Error ? error.message : String(error)}`);
  }

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async (): Promise<void> => {
      try {
        await writeResponse(res, await server.handle(incomingMessageToRequest(req, "127.0.0.1", port)));
      } catch {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Internal error" } }));
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.on("error", reject);
    if (options.socket !== undefined) {
      if (existsSync(options.socket)) unlinkSync(options.socket);
      httpServer.listen(options.socket, () => resolve());
    } else {
      httpServer.listen(port, "127.0.0.1", () => resolve());
    }
  });

  const address = options.socket ?? `http://127.0.0.1:${port}`;
  log(
    [
      "",
      `  ${bold("rehydra serve")}`,
      "",
      `  Listening   ${green(address)}`,
      `  NER         ${options.ner === "disabled" ? dim("disabled") : green(options.ner)}`,
      `  Storage     ${options.db !== undefined ? green(options.db) : dim("in memory")}`,
      ...(credentials !== undefined ? [`  Credentials ${green(Object.keys(credentials).join(", "))}`] : []),
      givenToken === undefined
        ? `  Token       ${yellow(token)} ${dim("(generated; pass --token or REHYDRA_SERVE_TOKEN to fix it)")}`
        : `  Token       ${green("configured")}`,
      "",
      `  ${dim("Ctrl+C to stop")}`,
      "",
    ].join("\n") + "\n",
  );

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      log(dim("\nShutting down...\n"));
      httpServer.close(() => resolve());
      // Node 18 waits for idle keep-alive connections before close() finishes.
      httpServer.closeIdleConnections();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await server.dispose();
  return 0;
}
