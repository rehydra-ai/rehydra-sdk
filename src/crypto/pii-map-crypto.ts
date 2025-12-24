/**
 * PII Map Encryption
 * AES-256-GCM encryption for the PII mapping
 */

import * as crypto from 'crypto';
import { EncryptedPIIMap } from '../types/index.js';
import type { RawPIIMap } from '../pipeline/tagger.js';

/**
 * Encryption configuration
 */
export interface EncryptionConfig {
  /** Algorithm (default: aes-256-gcm) */
  algorithm: string;
  /** IV length in bytes (default: 12 for GCM) */
  ivLength: number;
  /** Auth tag length in bytes (default: 16) */
  authTagLength: number;
}

/**
 * Default encryption configuration
 */
export const DEFAULT_ENCRYPTION_CONFIG: EncryptionConfig = {
  algorithm: 'aes-256-gcm',
  ivLength: 12,
  authTagLength: 16,
};

/**
 * Key generation options
 */
export interface KeyGenOptions {
  /** Key length in bytes (default: 32 for AES-256) */
  length: number;
}

/**
 * Generates a random encryption key
 * @returns Buffer containing the key
 */
export function generateKey(options: Partial<KeyGenOptions> = {}): Buffer {
  const length = options.length ?? 32;
  return crypto.randomBytes(length);
}

/**
 * Derives a key from a password using PBKDF2
 * @param password - Password string
 * @param salt - Salt buffer (should be randomly generated and stored)
 * @param iterations - Number of iterations (default: 100000)
 * @returns Buffer containing the derived key
 */
export function deriveKey(
  password: string,
  salt: Buffer,
  iterations: number = 100000
): Buffer {
  return crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
}

/**
 * Generates a random salt for key derivation
 * @param length - Salt length in bytes (default: 16)
 * @returns Buffer containing the salt
 */
export function generateSalt(length: number = 16): Buffer {
  return crypto.randomBytes(length);
}

/**
 * Encrypts a PII map using AES-256-GCM
 * @param piiMap - Raw PII map to encrypt
 * @param key - 32-byte encryption key
 * @param config - Encryption configuration
 * @returns Encrypted PII map
 */
export function encryptPIIMap(
  piiMap: RawPIIMap,
  key: Buffer,
  config: Partial<EncryptionConfig> = {}
): EncryptedPIIMap {
  const encConfig = { ...DEFAULT_ENCRYPTION_CONFIG, ...config };

  // Validate key length
  if (key.length !== 32) {
    throw new Error(`Invalid key length: expected 32 bytes, got ${key.length}`);
  }

  // Convert map to JSON
  const mapObject: Record<string, string> = {};
  for (const [k, v] of piiMap) {
    mapObject[k] = v;
  }
  const plaintext = JSON.stringify(mapObject);

  // Generate random IV
  const iv = crypto.randomBytes(encConfig.ivLength);

  // Create cipher
  const cipher = crypto.createCipheriv(
    encConfig.algorithm as crypto.CipherGCMTypes,
    key,
    iv,
    { authTagLength: encConfig.authTagLength }
  );

  // Encrypt
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  // Get auth tag
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypts an encrypted PII map
 * @param encrypted - Encrypted PII map
 * @param key - 32-byte encryption key
 * @param config - Encryption configuration
 * @returns Decrypted PII map
 */
export function decryptPIIMap(
  encrypted: EncryptedPIIMap,
  key: Buffer,
  config: Partial<EncryptionConfig> = {}
): RawPIIMap {
  const encConfig = { ...DEFAULT_ENCRYPTION_CONFIG, ...config };

  // Validate key length
  if (key.length !== 32) {
    throw new Error(`Invalid key length: expected 32 bytes, got ${key.length}`);
  }

  // Decode base64
  const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');
  const iv = Buffer.from(encrypted.iv, 'base64');
  const authTag = Buffer.from(encrypted.authTag, 'base64');

  // Create decipher
  const decipher = crypto.createDecipheriv(
    encConfig.algorithm as crypto.CipherGCMTypes,
    key,
    iv,
    { authTagLength: encConfig.authTagLength }
  );

  // Set auth tag
  decipher.setAuthTag(authTag);

  // Decrypt
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  // Parse JSON back to map
  const mapObject = JSON.parse(decrypted.toString('utf8')) as Record<string, string>;
  const piiMap: RawPIIMap = new Map();

  for (const [k, v] of Object.entries(mapObject)) {
    piiMap.set(k, v);
  }

  return piiMap;
}

/**
 * Key provider interface for external key management
 */
export interface KeyProvider {
  /** Gets the current encryption key */
  getKey(): Promise<Buffer>;
  /** Rotates to a new key (optional) */
  rotateKey?(): Promise<Buffer>;
}

/**
 * Simple in-memory key provider (for testing/development)
 * WARNING: Not secure for production use
 */
export class InMemoryKeyProvider implements KeyProvider {
  private key: Buffer;

  constructor(key?: Buffer) {
    this.key = key ?? generateKey();
  }

  getKey(): Promise<Buffer> {
    return Promise.resolve(this.key);
  }

  rotateKey(): Promise<Buffer> {
    this.key = generateKey();
    return Promise.resolve(this.key);
  }
}

/**
 * Environment variable key provider
 * Reads key from environment variable (base64 encoded)
 */
export class EnvKeyProvider implements KeyProvider {
  private envVarName: string;

  constructor(envVarName: string = 'PII_ENCRYPTION_KEY') {
    this.envVarName = envVarName;
  }

  getKey(): Promise<Buffer> {
    const keyBase64 = process.env[this.envVarName];
    if (keyBase64 === undefined || keyBase64.length === 0) {
      return Promise.reject(new Error(`Encryption key not found in environment variable: ${this.envVarName}`));
    }

    const key = Buffer.from(keyBase64, 'base64');
    if (key.length !== 32) {
      return Promise.reject(new Error(`Invalid key length from ${this.envVarName}: expected 32 bytes`));
    }

    return Promise.resolve(key);
  }
}

/**
 * Validates that a key is suitable for AES-256
 */
export function validateKey(key: Buffer): boolean {
  return key.length === 32;
}

/**
 * Securely compares two buffers (timing-safe)
 */
export function secureCompare(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

