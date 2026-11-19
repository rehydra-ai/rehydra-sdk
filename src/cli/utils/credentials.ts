import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { CredentialStore, type CredentialsConfig, type CredentialSource } from "../../core/credentials.js";
import { CLIError } from "./errors.js";

/**
 * Reads a credentials JSON file. Relative `{ "file": ... }` paths are
 * resolved against the JSON file's directory. The values are resolved once
 * here so a missing environment variable or file fails at startup instead of
 * on the first request.
 */
export async function loadCredentialsFile(path: string): Promise<CredentialsConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CLIError(`Could not read credentials file ${path}: ${reason}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CLIError(`Credentials file ${path} must contain a JSON object of named credentials`);
  }

  const base = dirname(resolve(path));
  const resolveSource = (source: CredentialSource): CredentialSource =>
    typeof source === "object" && source !== null && "file" in source && !isAbsolute(source.file)
      ? { file: resolve(base, source.file) }
      : source;

  const credentials: CredentialsConfig = {};
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || typeof value !== "object") {
      throw new CLIError(`Credential "${name}" in ${path} must be an object`);
    }
    const credential = value as CredentialsConfig[string];
    credentials[name] = {
      ...credential,
      password: resolveSource(credential.password),
      ...(credential.username === undefined ? {} : { username: resolveSource(credential.username) }),
    };
  }

  try {
    await new CredentialStore(credentials).load((file) => readFile(file, "utf8"));
  } catch (error) {
    throw new CLIError(error instanceof Error ? error.message : String(error));
  }
  return credentials;
}
