/**
 * Default system instruction for PII placeholder handling.
 *
 * Injected into the system prompt when anonymization produces PII replacements,
 * telling the model to treat PII placeholders as opaque pass-through values.
 *
 * Shared between the proxy layer and the OpenCode plugin.
 */
export const DEFAULT_PII_SYSTEM_INSTRUCTION = [
  "Some values in this conversation have been replaced with PII placeholders like <PII type=\"...\" id=\"...\"/>.",
  "These are real values that have been masked for privacy during transit.",
  "They will be automatically rehydrated (replaced with the original values) before any command is executed locally.",
  "IMPORTANT: Treat these placeholders exactly like real values.",
  "Do NOT try to resolve, decode, remove, or work around them.",
  "Use them as-is in commands, code, and tool calls.",
  "For example, if a user message contains <PII type=\"EMAIL\" id=\"1\"/>, pass that exact placeholder as the email argument in any tool call.",
  "The rehydration layer handles the rest.",
].join(" ");
