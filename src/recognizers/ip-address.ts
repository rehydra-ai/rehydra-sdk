/**
 * IP Address Recognizer
 * Detects IPv4 and IPv6 addresses
 */

import { PIIType, SpanMatch, DetectionSource } from '../types/index.js';
import type { Recognizer } from './base.js';

/**
 * IPv4 address pattern
 * Matches: 0.0.0.0 to 255.255.255.255
 * Requires at least one octet > 0 to avoid matching version numbers like 1.2.3.4
 */
const IPV4_PATTERN =
  /\b(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])\b/g;

/**
 * IPv6 address patterns
 * Covers standard, compressed, and mixed formats
 */
const IPV6_PATTERNS = [
  // Full format: 8 groups of 4 hex digits
  /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,

  // Compressed format with ::
  /\b(?:[0-9a-fA-F]{1,4}:){1,7}:\b/g,
  /\b(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}\b/g,
  /\b(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}\b/g,
  /\b(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}\b/g,
  /\b(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}\b/g,
  /\b(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}\b/g,
  /\b[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}\b/g,
  /\b::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}\b/g,
  /\b::\b/g, // Loopback shorthand

  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  /\b::ffff:(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/gi,
];

/**
 * Common internal/local IP ranges to optionally exclude
 */
const INTERNAL_IPV4_RANGES = [
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^127\./, // Loopback
  /^0\./, // Invalid
];

/**
 * IP Address recognizer (IPv4 and IPv6)
 */
export const ipAddressRecognizer: Recognizer = {
  type: PIIType.IP_ADDRESS,
  name: 'IP Address',
  defaultConfidence: 0.9,

  find(text: string): SpanMatch[] {
    const matches: SpanMatch[] = [];
    const seen = new Set<string>();

    // Find IPv4 addresses
    const ipv4Pattern = new RegExp(IPV4_PATTERN.source, 'g');
    for (const match of text.matchAll(ipv4Pattern)) {
      if (match.index === undefined) continue;

      const ip = match[0];
      const key = `${match.index}:${match.index + ip.length}`;

      if (seen.has(key)) continue;
      if (!this.validate!(ip)) continue;

      seen.add(key);
      matches.push({
        type: PIIType.IP_ADDRESS,
        start: match.index,
        end: match.index + ip.length,
        confidence: this.defaultConfidence,
        source: DetectionSource.REGEX,
        text: ip,
      });
    }

    // Find IPv6 addresses
    for (const pattern of IPV6_PATTERNS) {
      const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');

      for (const match of text.matchAll(globalPattern)) {
        if (match.index === undefined) continue;

        const ip = match[0];

        // Skip very short matches that might be false positives
        if (ip.length < 3) continue;

        const key = `${match.index}:${match.index + ip.length}`;

        if (seen.has(key)) continue;

        // Basic IPv6 validation
        if (!isValidIPv6(ip)) continue;

        seen.add(key);
        matches.push({
          type: PIIType.IP_ADDRESS,
          start: match.index,
          end: match.index + ip.length,
          confidence: this.defaultConfidence * 0.95, // Slightly lower confidence for IPv6
          source: DetectionSource.REGEX,
          text: ip,
        });
      }
    }

    return matches;
  },

  validate(ip: string): boolean {
    // Check if it's IPv4
    if (ip.includes('.') && !ip.includes(':')) {
      if (!isValidIPv4(ip)) return false;
      // Skip localhost and private/internal IPs — not PII
      if (isInternalIPv4(ip)) return false;
      return true;
    }

    // Check if it's IPv6
    if (ip.includes(':')) {
      return isValidIPv6(ip);
    }

    return false;
  },

  normalize(ip: string): string {
    return ip.toLowerCase().trim();
  },
};

/**
 * Validates an IPv4 address
 */
function isValidIPv4(ip: string): boolean {
  const parts = ip.split('.');

  if (parts.length !== 4) return false;

  let hasLargeOctet = false;

  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return false;
    // Check for leading zeros (except for 0 itself)
    if (part.length > 1 && part.startsWith('0')) return false;
    // Track if any octet is > 9 (helps distinguish from version numbers)
    if (num > 9) hasLargeOctet = true;
  }

  // Require at least one octet > 9 to avoid matching version numbers like 1.2.3.4
  return hasLargeOctet;
}

/**
 * Validates an IPv6 address
 */
function isValidIPv6(ip: string): boolean {
  // Handle IPv4-mapped addresses
  if (ip.toLowerCase().startsWith('::ffff:') && ip.includes('.')) {
    const ipv4Part = ip.slice(7);
    return isValidIPv4(ipv4Part);
  }

  // Count colons and check for ::
  const colonCount = (ip.match(/:/g) ?? []).length;
  const hasDoubleColon = ip.includes('::');

  // If has ::, must have less than 8 groups
  if (hasDoubleColon) {
    // Can only have one ::
    if ((ip.match(/::/g) ?? []).length > 1) return false;
    // Should have at least 2 colons (including the ::)
    if (colonCount < 2) return false;
  } else {
    // Must have exactly 7 colons for 8 groups
    if (colonCount !== 7) return false;
  }

  // Check each part is valid hex
  const parts = ip.split(':');
  for (const part of parts) {
    if (part === '') continue; // Empty parts are OK with ::
    if (part.length > 4) return false;
    if (!/^[0-9a-fA-F]+$/.test(part)) return false;
  }

  return true;
}

/**
 * Checks if an IPv4 address is in a private/internal range
 */
export function isInternalIPv4(ip: string): boolean {
  return INTERNAL_IPV4_RANGES.some((pattern) => pattern.test(ip));
}

