/**
 * Vitest setup file
 * Ensures globalThis.crypto is available in Node.js test environment
 */

import { webcrypto } from 'crypto';

// Polyfill globalThis.crypto for Node.js environments
// Node.js 19+ has this built-in, but older versions and some CI environments don't
if (typeof globalThis.crypto === 'undefined') {
  // @ts-expect-error - webcrypto is compatible with Web Crypto API
  globalThis.crypto = webcrypto;
}

