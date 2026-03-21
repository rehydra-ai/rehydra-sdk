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
import { envVarSecretRecognizer } from "./env-var.js";
import { configSecretRecognizer } from "./config-secret.js";

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
export function createSecretRecognizers(): Recognizer[] {
  return [
    apiKeyRecognizer,
    privateKeyRecognizer,
    jwtRecognizer,
    connectionStringRecognizer,
    awsCredentialsRecognizer,
    envVarSecretRecognizer,
    configSecretRecognizer,
  ];
}
