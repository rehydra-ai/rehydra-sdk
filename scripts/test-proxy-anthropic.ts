#!/usr/bin/env npx tsx
/**
 * Integration test: LLM Proxy with Anthropic Claude
 *
 * Sends a prompt containing PII through the Rehydra proxy to Anthropic.
 * Verifies that PII is anonymized before leaving your machine
 * and rehydrated in the response.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/test-proxy-anthropic.ts          # regex-only
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/test-proxy-anthropic.ts --ner    # with NER (detects names)
 */

import {
  createRehydraFetch,
  InMemoryKeyProvider,
  InMemoryPIIStorageProvider,
  decryptPIIMap,
} from "../src/index.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY environment variable is required.");
  console.error("Usage: ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/test-proxy-anthropic.ts");
  process.exit(1);
}

async function main(): Promise<void> {
  console.log("=== Anthropic Proxy Integration Test ===\n");

  const storage = new InMemoryPIIStorageProvider();
  const keyProvider = new InMemoryKeyProvider();
  const sessionId = "anthropic-test";

  const nerMode = process.argv.includes("--ner") ? "quantized" as const : "disabled" as const;
  console.log(`NER mode: ${nerMode}${nerMode === "disabled" ? " (pass --ner to enable)" : ""}\n`);

  const rehydraFetch = createRehydraFetch({
    anonymizer: { ner: { mode: nerMode } },
    keyProvider,
    piiStorageProvider: storage,
    provider: "anthropic",
    getSessionId: async () => sessionId,
  });

  const prompt =
    "Write a very short confirmation (2 sentences max) that you received an email from John Smith at john.smith@acme-corp.com " +
    "about rescheduling a meeting. His phone number is +1-555-867-5309.";

  console.log("Prompt (with PII):");
  console.log(`  ${prompt}\n`);

  // --- Non-streaming request ---
  console.log("--- Non-streaming request ---\n");

  const response = await rehydraFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Anthropic API error (${response.status}): ${errorBody}`);
    process.exit(1);
  }

  const data = await response.json() as any;
  const rehydratedResponse = data.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");

  console.log("Response (rehydrated — PII restored):");
  console.log(`  ${rehydratedResponse}\n`);

  // Show what was stored in the PII map
  const stored = await storage.load(sessionId);
  if (stored !== null) {
    const key = await keyProvider.getKey();
    const piiMap = await decryptPIIMap(stored.piiMap, key);
    console.log("PII Map (what was anonymized):");
    for (const [tag, value] of piiMap) {
      console.log(`  ${tag} → ${value}`);
    }
    console.log();
    console.log("Entity counts:", stored.metadata.entityCounts);
  }

  // --- Streaming request ---
  console.log("\n--- Streaming request (SSE) ---\n");

  const streamSessionId = "anthropic-stream-test";
  const streamFetch = createRehydraFetch({
    anonymizer: { ner: { mode: nerMode } },
    keyProvider,
    piiStorageProvider: storage,
    provider: "anthropic",
    getSessionId: async () => streamSessionId,
    handleStreaming: true,
  });

  const streamResponse = await streamFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    }),
  });

  if (!streamResponse.ok) {
    const errorBody = await streamResponse.text();
    console.error(`Anthropic API error (${streamResponse.status}): ${errorBody}`);
    process.exit(1);
  }

  process.stdout.write("Streaming response: ");

  const reader = streamResponse.body!.getReader();
  const decoder = new TextDecoder();
  let streamDone = false;

  while (!streamDone) {
    const { done, value } = await reader.read();
    if (done) {
      streamDone = true;
      break;
    }
    const text = decoder.decode(value, { stream: true });
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const parsed = JSON.parse(line.slice(6));
          if (parsed.type === "content_block_delta" && parsed.delta?.text) {
            process.stdout.write(parsed.delta.text);
          }
        } catch {
          // skip
        }
      }
    }
  }

  console.log("\n");

  const streamStored = await storage.load(streamSessionId);
  if (streamStored !== null) {
    console.log("Stream session entity counts:", streamStored.metadata.entityCounts);
  }

  console.log("\n=== Anthropic proxy test complete ===");
}

main().catch(console.error);
