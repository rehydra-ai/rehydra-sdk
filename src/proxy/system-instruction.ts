/**
 * Default system instruction for PII placeholder handling.
 *
 * Injected into the system prompt when anonymization produces PII replacements,
 * telling the model to treat PII placeholders as opaque pass-through values.
 *
 * Shared between the proxy layer and the OpenCode plugin.
 */

import type { TagFormat } from "../types/index.js";
import { DEFAULT_TAG_FORMAT, PIIType } from "../types/index.js";
import type { CredentialDescription } from "../core/credentials.js";
import { generateTag } from "../pipeline/tagger.js";

/**
 * Builds a system instruction string using the configured tag format.
 * When credentials are given, the instruction also lists them by name.
 */
export function buildPIISystemInstruction(
  tagFormat: TagFormat = DEFAULT_TAG_FORMAT,
  credentials: readonly CredentialDescription[] = [],
): string {
  const keyword = tagFormat.keyword ?? "PII";
  const exampleTag = `${tagFormat.open}${keyword} type="..." id="..."${tagFormat.close}`;
  const emailTag = `${tagFormat.open}${keyword} type="EMAIL" id="1"${tagFormat.close}`;

  const instruction = [
    `Some values in this conversation have been replaced with PII placeholders like ${exampleTag}.`,
    "These are real values that have been masked for privacy during transit.",
    "They will be automatically rehydrated (replaced with the original values) before any command is executed locally.",
    "IMPORTANT: Treat these placeholders exactly like real values.",
    "Do NOT try to resolve, decode, remove, or work around them.",
    "Use them as-is in commands, code, and tool calls.",
    `For example, if a user message contains ${emailTag}, pass that exact placeholder as the email argument in any tool call.`,
    "The rehydration layer handles the rest.",
  ].join(" ");

  const credentialSection = buildCredentialInstruction(tagFormat, credentials);
  return credentialSection === "" ? instruction : `${instruction}\n\n${credentialSection}`;
}

/**
 * Lists configured credentials by name, description and placeholder. Never
 * includes values. Returns an empty string when there are none.
 */
export function buildCredentialInstruction(
  tagFormat: TagFormat = DEFAULT_TAG_FORMAT,
  credentials: readonly CredentialDescription[] = [],
): string {
  if (credentials.length === 0) return "";
  const lines = credentials.map((credential) => {
    const parts = [`- ${credential.name}`];
    if (credential.description !== undefined) parts.push(`(${credential.description})`);
    const placeholders: string[] = [];
    if (credential.hasUsername) {
      placeholders.push(`username ${generateTag(PIIType.USERNAME, credential.name, undefined, tagFormat)}`);
    }
    placeholders.push(`password ${generateTag(PIIType.PASSWORD, credential.name, undefined, tagFormat)}`);
    parts.push(`: ${placeholders.join(", ")}.`);
    if (credential.tools !== undefined) parts.push(`Only works in these tools: ${credential.tools.join(", ")}.`);
    if (credential.hosts !== undefined) parts.push(`Only works for these hosts: ${credential.hosts.join(", ")}.`);
    return parts.join(" ").replace(" :", ":");
  });
  return [
    "Credentials you can use in tool calls:",
    ...lines,
    "Put these placeholders exactly as written wherever the username or password belongs in a tool call.",
    "The real values are filled in only inside tool calls; they never appear in your replies or in tool output.",
  ].join("\n");
}

/**
 * Default system instruction using XML-style tag format.
 * Kept for backwards compatibility.
 */
export const DEFAULT_PII_SYSTEM_INSTRUCTION = buildPIISystemInstruction();
