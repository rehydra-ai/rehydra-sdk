/**
 * JWT Recognizer
 * Detects JSON Web Tokens (three base64url dot-separated segments)
 */

import { createRegexRecognizer } from "../base.js";
import { PIIType } from "../../types/index.js";

/**
 * Decode base64url to string (no padding required)
 */
function base64urlDecode(str: string): string | null {
  try {
    // Replace base64url chars with standard base64
    const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    // Add padding if needed
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return atob(padded);
  } catch {
    return null;
  }
}

export const jwtRecognizer = createRegexRecognizer({
  type: PIIType.JWT,
  name: "JWT",
  defaultConfidence: 0.95,
  patterns: [
    // JWT: eyJ header prefix, three base64url segments separated by dots
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  ],
  validate(match: string): boolean {
    const parts = match.split(".");
    if (parts.length !== 3) return false;

    // Decode header and verify it has an "alg" field
    const header = base64urlDecode(parts[0]!);
    if (header === null) return false;

    try {
      const parsed = JSON.parse(header) as Record<string, unknown>;
      return typeof parsed.alg === "string";
    } catch {
      return false;
    }
  },
});
