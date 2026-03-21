/**
 * API Key Recognizer
 * Detects provider-specific API key patterns
 */

import { createRegexRecognizer } from "../base.js";
import { PIIType } from "../../types/index.js";

export const apiKeyRecognizer = createRegexRecognizer({
  type: PIIType.API_KEY,
  name: "API Key",
  defaultConfidence: 0.97,
  patterns: [
    // OpenAI
    /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g,
    /\bsk-[A-Za-z0-9]{20,}\b/g,
    // Anthropic
    /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    // GitHub (PAT, OAuth, App, Installation, Refresh)
    /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
    // Stripe
    /\b[sr]k_(?:live|test)_[A-Za-z0-9]{24,}\b/g,
    // Slack bot/user tokens
    /\bxox[bpas]-[0-9]{10,}-[A-Za-z0-9-]+/g,
    // SendGrid
    /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g,
    // Twilio
    /\bSK[a-f0-9]{32}\b/g,
    // Mailgun
    /\bkey-[a-f0-9]{32}\b/g,
    // Heroku
    /\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/g,
  ],
  validate(match: string): boolean {
    // Heroku-style UUIDs are too generic without context — skip them
    if (/^[a-f0-9]{8}-[a-f0-9]{4}-/.test(match)) return false;
    // Must be at least 20 chars for non-prefixed patterns
    return match.length >= 20;
  },
});
