/**
 * Connection String Recognizer
 * Detects database/service URIs with embedded credentials
 */

import { createRegexRecognizer } from "../base.js";
import { PIIType } from "../../types/index.js";

const PLACEHOLDER_PASSWORDS = new Set([
  "password", "pass", "changeme", "secret", "xxx", "yyy",
  "your-password", "your_password", "example", "<password>",
]);

export const connectionStringRecognizer = createRegexRecognizer({
  type: PIIType.CONNECTION_STRING,
  name: "Connection String",
  defaultConfidence: 0.93,
  patterns: [
    // postgres://user:password@host/db
    /\b(?:postgres(?:ql)?|mysql|mariadb):\/\/[^\s:]+:[^\s@]+@[^\s]+/g,
    // mongodb+srv://user:password@host/db
    /\bmongodb(?:\+srv)?:\/\/[^\s:]+:[^\s@]+@[^\s]+/g,
    // redis://user:password@host:port or redis://:password@host:port
    /\brediss?:\/\/(?:[^\s:]*:)?[^\s@]+@[^\s]+/g,
    // amqp://user:password@host:port
    /\bamqps?:\/\/[^\s:]+:[^\s@]+@[^\s]+/g,
  ],
  validate(match: string): boolean {
    // Extract password portion (between first : after // and @)
    const credMatch = match.match(/:\/\/[^:]*:([^@]+)@/);
    if (credMatch === null) return false;

    const password = credMatch[1]!;
    // Reject placeholder passwords
    if (PLACEHOLDER_PASSWORDS.has(password.toLowerCase())) return false;
    // Reject very short passwords (likely placeholders)
    if (password.length < 4) return false;

    return true;
  },
});
