/**
 * Default system instruction for PII placeholder handling.
 *
 * Injected into the system prompt when anonymization produces PII replacements,
 * telling the model to treat PII placeholders as opaque pass-through values.
 *
 * Shared between the proxy layer and the OpenCode plugin.
 */

import type { TagFormat } from "../types/index.js";
import { DEFAULT_TAG_FORMAT } from "../types/index.js";

/**
 * Builds a system instruction string using the configured tag format.
 */
export function buildPIISystemInstruction(
  tagFormat: TagFormat = DEFAULT_TAG_FORMAT
): string {
  const keyword = tagFormat.keyword ?? "PII";
  const exampleTag = `${tagFormat.open}${keyword} type="..." id="..."${tagFormat.close}`;
  const emailTag = `${tagFormat.open}${keyword} type="EMAIL" id="1"${tagFormat.close}`;

  return [
    `Some values in this conversation have been replaced with PII placeholders like ${exampleTag}.`,
    "These are real values that have been masked for privacy during transit.",
    "They will be automatically rehydrated (replaced with the original values) before any command is executed locally.",
    "IMPORTANT: Treat these placeholders exactly like real values.",
    "Do NOT try to resolve, decode, remove, or work around them.",
    "Use them as-is in commands, code, and tool calls.",
    `For example, if a user message contains ${emailTag}, pass that exact placeholder as the email argument in any tool call.`,
    "The rehydration layer handles the rest.",
  ].join(" ");
}

/**
 * Default system instruction using XML-style tag format.
 * Kept for backwards compatibility.
 */
export const DEFAULT_PII_SYSTEM_INSTRUCTION = buildPIISystemInstruction();
