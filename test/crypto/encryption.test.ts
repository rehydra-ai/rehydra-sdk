import { describe, it, expect } from 'vitest';
import {
  encryptPIIMap,
  decryptPIIMap,
  generateKey,
  generateSalt,
  deriveKey,
  validateKey,
  secureCompare,
  InMemoryKeyProvider,
  ConfigKeyProvider,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from '../../src/crypto/pii-map-crypto.js';

/**
 * Helper to check if two Uint8Arrays are equal
 */
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

describe('PII Map Encryption', () => {
  describe('Base64 Utilities', () => {
    it('should encode and decode Uint8Array to Base64', () => {
      const original = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const base64 = uint8ArrayToBase64(original);
      const decoded = base64ToUint8Array(base64);

      expect(arraysEqual(original, decoded)).toBe(true);
    });

    it('should handle empty array', () => {
      const original = new Uint8Array([]);
      const base64 = uint8ArrayToBase64(original);
      const decoded = base64ToUint8Array(base64);

      expect(arraysEqual(original, decoded)).toBe(true);
    });

    it('should handle all byte values', () => {
      const original = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        original[i] = i;
      }

      const base64 = uint8ArrayToBase64(original);
      const decoded = base64ToUint8Array(base64);

      expect(arraysEqual(original, decoded)).toBe(true);
    });
  });

  describe('generateKey', () => {
    it('should generate a 32-byte key by default', () => {
      const key = generateKey();
      expect(key.length).toBe(32);
    });

    it('should generate unique keys', () => {
      const key1 = generateKey();
      const key2 = generateKey();
      expect(arraysEqual(key1, key2)).toBe(false);
    });

    it('should generate custom length keys', () => {
      const key = generateKey({ length: 16 });
      expect(key.length).toBe(16);
    });
  });

  describe('generateSalt', () => {
    it('should generate a 16-byte salt by default', () => {
      const salt = generateSalt();
      expect(salt.length).toBe(16);
    });

    it('should generate custom length salts', () => {
      const salt = generateSalt(32);
      expect(salt.length).toBe(32);
    });
  });

  describe('deriveKey', () => {
    it('should derive consistent key from password and salt', async () => {
      const password = 'test-password';
      const salt = generateSalt();

      const key1 = await deriveKey(password, salt);
      const key2 = await deriveKey(password, salt);

      expect(arraysEqual(key1, key2)).toBe(true);
      expect(key1.length).toBe(32);
    });

    it('should derive different keys for different passwords', async () => {
      const salt = generateSalt();

      const key1 = await deriveKey('password1', salt);
      const key2 = await deriveKey('password2', salt);

      expect(arraysEqual(key1, key2)).toBe(false);
    });

    it('should derive different keys for different salts', async () => {
      const password = 'test-password';

      const key1 = await deriveKey(password, generateSalt());
      const key2 = await deriveKey(password, generateSalt());

      expect(arraysEqual(key1, key2)).toBe(false);
    });

    it('should support custom iteration count', async () => {
      const password = 'test-password';
      const salt = generateSalt();

      // Different iteration counts should produce different keys
      const key1 = await deriveKey(password, salt, 1000);
      const key2 = await deriveKey(password, salt, 2000);

      expect(arraysEqual(key1, key2)).toBe(false);
    });
  });

  describe('encryptPIIMap / decryptPIIMap', () => {
    it('should encrypt and decrypt a PII map', async () => {
      const key = generateKey();
      const originalMap = new Map([
        ['PERSON_1', 'John Smith'],
        ['EMAIL_2', 'john@example.com'],
        ['PHONE_3', '+49123456789'],
      ]);

      const encrypted = await encryptPIIMap(originalMap, key);
      const decrypted = await decryptPIIMap(encrypted, key);

      expect(decrypted.size).toBe(originalMap.size);
      expect(decrypted.get('PERSON_1')).toBe('John Smith');
      expect(decrypted.get('EMAIL_2')).toBe('john@example.com');
      expect(decrypted.get('PHONE_3')).toBe('+49123456789');
    });

    it('should produce different ciphertext for same data', async () => {
      const key = generateKey();
      const map = new Map([['PERSON_1', 'John']]);

      const encrypted1 = await encryptPIIMap(map, key);
      const encrypted2 = await encryptPIIMap(map, key);

      // Different IVs should produce different ciphertext
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });

    it('should handle empty map', async () => {
      const key = generateKey();
      const emptyMap = new Map<string, string>();

      const encrypted = await encryptPIIMap(emptyMap, key);
      const decrypted = await decryptPIIMap(encrypted, key);

      expect(decrypted.size).toBe(0);
    });

    it('should handle special characters in values', async () => {
      const key = generateKey();
      const map = new Map([
        ['PERSON_1', 'Müller, Hans-Peter'],
        ['ADDRESS_2', '123 Main St.\nApt #4\n"Suite"'],
      ]);

      const encrypted = await encryptPIIMap(map, key);
      const decrypted = await decryptPIIMap(encrypted, key);

      expect(decrypted.get('PERSON_1')).toBe('Müller, Hans-Peter');
      expect(decrypted.get('ADDRESS_2')).toBe('123 Main St.\nApt #4\n"Suite"');
    });

    it('should fail with wrong key', async () => {
      const key1 = generateKey();
      const key2 = generateKey();
      const map = new Map([['PERSON_1', 'John']]);

      const encrypted = await encryptPIIMap(map, key1);

      await expect(decryptPIIMap(encrypted, key2)).rejects.toThrow();
    });

    it('should fail with tampered ciphertext', async () => {
      const key = generateKey();
      const map = new Map([['PERSON_1', 'John']]);

      const encrypted = await encryptPIIMap(map, key);

      // Tamper with ciphertext
      const tamperedCiphertext = base64ToUint8Array(encrypted.ciphertext);
      tamperedCiphertext[0] = (tamperedCiphertext[0]! + 1) % 256;

      const tampered = {
        ...encrypted,
        ciphertext: uint8ArrayToBase64(tamperedCiphertext),
      };

      await expect(decryptPIIMap(tampered, key)).rejects.toThrow();
    });

    it('should throw for invalid key length', async () => {
      const shortKey = new Uint8Array(16); // Too short
      const map = new Map([['PERSON_1', 'John']]);

      await expect(encryptPIIMap(map, shortKey)).rejects.toThrow('Invalid key length');
    });
  });

  describe('validateKey', () => {
    it('should return true for valid key', () => {
      const key = generateKey();
      expect(validateKey(key)).toBe(true);
    });

    it('should return false for invalid key length', () => {
      expect(validateKey(new Uint8Array(16))).toBe(false);
      expect(validateKey(new Uint8Array(64))).toBe(false);
    });
  });

  describe('secureCompare', () => {
    it('should return true for equal arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 5]);
      expect(secureCompare(a, b)).toBe(true);
    });

    it('should return false for different arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 6]);
      expect(secureCompare(a, b)).toBe(false);
    });

    it('should return false for different length arrays', () => {
      const a = new Uint8Array([1, 2, 3]);
      const b = new Uint8Array([1, 2, 3, 4]);
      expect(secureCompare(a, b)).toBe(false);
    });

    it('should return true for empty arrays', () => {
      const a = new Uint8Array([]);
      const b = new Uint8Array([]);
      expect(secureCompare(a, b)).toBe(true);
    });
  });

  describe('InMemoryKeyProvider', () => {
    it('should return the same key', async () => {
      const provider = new InMemoryKeyProvider();

      const key1 = await provider.getKey();
      const key2 = await provider.getKey();

      expect(arraysEqual(key1, key2)).toBe(true);
    });

    it('should use provided key', async () => {
      const customKey = generateKey();
      const provider = new InMemoryKeyProvider(customKey);

      const key = await provider.getKey();

      expect(arraysEqual(key, customKey)).toBe(true);
    });

    it('should rotate to new key', async () => {
      const provider = new InMemoryKeyProvider();

      const key1 = await provider.getKey();
      const key2 = await provider.rotateKey!();
      const key3 = await provider.getKey();

      expect(arraysEqual(key1, key2)).toBe(false);
      expect(arraysEqual(key2, key3)).toBe(true);
    });
  });

  describe('ConfigKeyProvider', () => {
    it('should return the configured key', async () => {
      const key = generateKey();
      const keyBase64 = uint8ArrayToBase64(key);
      const provider = new ConfigKeyProvider(keyBase64);

      const retrievedKey = await provider.getKey();

      expect(arraysEqual(retrievedKey, key)).toBe(true);
    });

    it('should throw for empty key', () => {
      expect(() => new ConfigKeyProvider('')).toThrow('Encryption key must be provided');
    });

    it('should throw for invalid key length', () => {
      const shortKey = new Uint8Array(16);
      const keyBase64 = uint8ArrayToBase64(shortKey);

      expect(() => new ConfigKeyProvider(keyBase64)).toThrow('Invalid key length');
    });
  });
});
