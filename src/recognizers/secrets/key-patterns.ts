/**
 * Shared secret key name patterns
 * Used by ENV_VAR_SECRET and CONFIG_SECRET recognizers
 */

const SECRET_KEY_PATTERN = /^(?:.*_)?(?:password|passwd|pwd|pass|secret|secret_key|secretkey|token|access_token|refresh_token|auth_token|api_key|apikey|api_secret|private_key|privatekey|credential|credentials|connection_string|connectionstring|database_url|dsn|encryption_key|signing_key|client_secret|app_secret|master_key|auth|bearer|jwt|api_token)(?:_.*)?$/i;

/**
 * Checks if a key/variable name suggests it holds a secret value.
 * Handles snake_case, camelCase, and kebab-case.
 */
export function isSecretKeyName(key: string): boolean {
  // Normalize camelCase/PascalCase to snake_case for matching
  const normalized = key.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/-/g, "_");
  return SECRET_KEY_PATTERN.test(normalized);
}
