/**
 * PII Map Encryption
 * AES-256-GCM encryption for the PII mapping
 * Uses Web Crypto API for browser compatibility
 */

import { EncryptedPIIMap } from "../types/index.js";
import type { RawPIIMap } from "../pipeline/tagger.js";

// ============================================================================
// Base64 Utility Functions
// ============================================================================

/**
 * Converts a Uint8Array to a Base64 string
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const binString = Array.from(bytes, (b) => String.fromCodePoint(b)).join("");
  return btoa(binString);
}

/**
 * Converts a Base64 string to a Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binString = atob(base64);
  return Uint8Array.from(binString, (c) => c.codePointAt(0)!);
}

// ============================================================================
// Encryption Configuration
// ============================================================================

/**
 * Encryption configuration
 */
export interface EncryptionConfig {
  /** IV length in bytes (default: 12 for GCM) */
  ivLength: number;
  /** Auth tag length in bits (default: 128) */
  authTagLength: number;
}

/**
 * Default encryption configuration
 */
export const DEFAULT_ENCRYPTION_CONFIG: EncryptionConfig = {
  ivLength: 12,
  authTagLength: 128, // Web Crypto uses bits, not bytes
};

/**
 * Key generation options
 */
export interface KeyGenOptions {
  /** Key length in bytes (default: 32 for AES-256) */
  length: number;
}

// ============================================================================
// Core Crypto Functions
// ============================================================================

/**
 * Generates a random encryption key
 * @returns Promise resolving to Uint8Array containing the key
 */
export function generateKey(options: Partial<KeyGenOptions> = {}): Uint8Array {
  const length = options.length ?? 32;
  const key = new Uint8Array(length);
  globalThis.crypto.getRandomValues(key);
  return key;
}

/**
 * Generates a random salt for key derivation
 * @param length - Salt length in bytes (default: 16)
 * @returns Uint8Array containing the salt
 */
export function generateSalt(length: number = 16): Uint8Array {
  const salt = new Uint8Array(length);
  globalThis.crypto.getRandomValues(salt);
  return salt;
}

/**
 * Derives a key from a password using PBKDF2
 * @param password - Password string
 * @param salt - Salt Uint8Array (should be randomly generated and stored)
 * @param iterations - Number of iterations (default: 100000)
 * @returns Promise resolving to Uint8Array containing the derived key
 */
export async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number = 100000
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  // Import password as a key
  const baseKey = await globalThis.crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  // Derive bits using PBKDF2
  const derivedBits = await globalThis.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: iterations,
      hash: "SHA-256",
    },
    baseKey,
    256 // 32 bytes * 8 bits
  );

  return new Uint8Array(derivedBits);
}

// ============================================================================
// Encrypt / Decrypt Functions
// ============================================================================

/**
 * Encrypts a PII map using AES-256-GCM
 * @param piiMap - Raw PII map to encrypt
 * @param key - 32-byte encryption key as Uint8Array
 * @param config - Encryption configuration
 * @returns Promise resolving to encrypted PII map
 */
export async function encryptPIIMap(
  piiMap: RawPIIMap,
  key: Uint8Array,
  config: Partial<EncryptionConfig> = {}
): Promise<EncryptedPIIMap> {
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
  const iv = new Uint8Array(encConfig.ivLength);
  globalThis.crypto.getRandomValues(iv);

  // Import key for AES-GCM
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  // Encrypt using AES-GCM
  const encoder = new TextEncoder();
  const plaintextBuffer = encoder.encode(plaintext);

  const encryptedBuffer = await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
      tagLength: encConfig.authTagLength,
    },
    cryptoKey,
    plaintextBuffer
  );

  // Web Crypto returns ciphertext + authTag concatenated
  const encryptedArray = new Uint8Array(encryptedBuffer);
  const authTagBytes = encConfig.authTagLength / 8;
  const ciphertext = encryptedArray.slice(
    0,
    encryptedArray.length - authTagBytes
  );
  const authTag = encryptedArray.slice(encryptedArray.length - authTagBytes);

  return {
    ciphertext: uint8ArrayToBase64(ciphertext),
    iv: uint8ArrayToBase64(iv),
    authTag: uint8ArrayToBase64(authTag),
  };
}

/**
 * Decrypts an encrypted PII map
 * @param encrypted - Encrypted PII map
 * @param key - 32-byte encryption key as Uint8Array
 * @param config - Encryption configuration
 * @returns Promise resolving to decrypted PII map
 */
export async function decryptPIIMap(
  encrypted: EncryptedPIIMap,
  key: Uint8Array,
  config: Partial<EncryptionConfig> = {}
): Promise<RawPIIMap> {
  const encConfig = { ...DEFAULT_ENCRYPTION_CONFIG, ...config };

  // Validate key length
  if (key.length !== 32) {
    throw new Error(`Invalid key length: expected 32 bytes, got ${key.length}`);
  }

  // Decode base64
  const ciphertext = base64ToUint8Array(encrypted.ciphertext);
  const iv = base64ToUint8Array(encrypted.iv);
  const authTag = base64ToUint8Array(encrypted.authTag);

  // Web Crypto expects ciphertext + authTag concatenated
  const encryptedData = new Uint8Array(ciphertext.length + authTag.length);
  encryptedData.set(ciphertext, 0);
  encryptedData.set(authTag, ciphertext.length);

  // Import key for AES-GCM
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  // Decrypt using AES-GCM
  const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
      tagLength: encConfig.authTagLength,
    },
    cryptoKey,
    encryptedData
  );

  // Parse JSON back to map
  const decoder = new TextDecoder();
  const decryptedText = decoder.decode(decryptedBuffer);
  const mapObject = JSON.parse(decryptedText) as Record<string, string>;
  const piiMap: RawPIIMap = new Map();

  for (const [k, v] of Object.entries(mapObject)) {
    piiMap.set(k, v);
  }

  return piiMap;
}

// ============================================================================
// Key Provider Interfaces and Implementations
// ============================================================================

/**
 * Key provider interface for external key management
 */
export interface KeyProvider {
  /** Gets the current encryption key */
  getKey(): Promise<Uint8Array>;
  /** Rotates to a new key (optional) */
  rotateKey?(): Promise<Uint8Array>;
}

/**
 * Simple in-memory key provider (for testing/development)
 * WARNING: Not secure for production use
 */
export class InMemoryKeyProvider implements KeyProvider {
  private key: Uint8Array | null = null;
  private initialKey?: Uint8Array;

  constructor(key?: Uint8Array) {
    this.initialKey = key;
  }

  getKey(): Promise<Uint8Array> {
    if (this.key === null) {
      this.key = this.initialKey ?? generateKey();
    }
    return Promise.resolve(this.key);
  }

  rotateKey(): Promise<Uint8Array> {
    this.key = generateKey();
    return Promise.resolve(this.key);
  }
}

/**
 * Configuration-based key provider
 * Accepts the key at construction time (platform-agnostic)
 * Consumer is responsible for reading the key from environment variables or config
 */
export class ConfigKeyProvider implements KeyProvider {
  private key: Uint8Array;

  /**
   * Creates a new ConfigKeyProvider
   * @param keyBase64 - Base64-encoded 32-byte encryption key
   */
  constructor(keyBase64: string) {
    if (!keyBase64 || keyBase64.length === 0) {
      throw new Error("Encryption key must be provided");
    }

    this.key = base64ToUint8Array(keyBase64);
    if (this.key.length !== 32) {
      throw new Error(
        `Invalid key length: expected 32 bytes, got ${this.key.length}`
      );
    }
  }

  getKey(): Promise<Uint8Array> {
    return Promise.resolve(this.key);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Validates that a key is suitable for AES-256
 */
export function validateKey(key: Uint8Array): boolean {
  return key.length === 32;
}

/**
 * Securely compares two Uint8Arrays (constant-time)
 * Prevents timing attacks by always comparing all bytes
 */
export function secureCompare(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i]! ^ b[i]!;
  }
  return result === 0;
}
