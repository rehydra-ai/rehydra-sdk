/**
 * Secret Recognizers Module
 * Exports all secret/credential recognizers
 */

import type { Recognizer } from "../base.js";
import { apiKeyRecognizer } from "./api-key.js";
import { privateKeyRecognizer } from "./private-key.js";
import { jwtRecognizer } from "./jwt.js";
import { connectionStringRecognizer } from "./connection-string.js";
import { awsCredentialsRecognizer } from "./aws-credentials.js";
import { envVarSecretRecognizer, createEnvVarSecretRecognizer } from "./env-var.js";
import { configSecretRecognizer, createConfigSecretRecognizer } from "./config-secret.js";

export { apiKeyRecognizer } from "./api-key.js";
export { privateKeyRecognizer } from "./private-key.js";
export { jwtRecognizer } from "./jwt.js";
export { connectionStringRecognizer } from "./connection-string.js";
export { awsCredentialsRecognizer } from "./aws-credentials.js";
export { envVarSecretRecognizer, createEnvVarSecretRecognizer } from "./env-var.js";
export { configSecretRecognizer, createConfigSecretRecognizer } from "./config-secret.js";
export { createLiteralValueRecognizer } from "./literal-value.js";
export { isSecretKeyName } from "./key-patterns.js";

/**
 * Creates all secret recognizers
 */
export function createSecretRecognizers(options?: {
  secretKeyPatterns?: RegExp[];
  minValueLength?: number;
}): Recognizer[] {
  const hasCustomOptions =
    (options?.secretKeyPatterns !== undefined && options.secretKeyPatterns.length > 0) ||
    options?.minValueLength !== undefined;

  return [
    apiKeyRecognizer,
    privateKeyRecognizer,
    jwtRecognizer,
    connectionStringRecognizer,
    awsCredentialsRecognizer,
    hasCustomOptions
      ? createEnvVarSecretRecognizer(options?.minValueLength, options?.secretKeyPatterns)
      : envVarSecretRecognizer,
    hasCustomOptions
      ? createConfigSecretRecognizer(options?.minValueLength, options?.secretKeyPatterns)
      : configSecretRecognizer,
  ];
}
