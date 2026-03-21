#!/usr/bin/env npx tsx
/**
 * Integration test: LLM Proxy with OpenAI
 *
 * Sends a prompt containing PII through the Rehydra proxy to OpenAI.
 * Verifies that PII is anonymized before leaving your machine
 * and rehydrated in the response.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npx tsx scripts/test-proxy-openai.ts          # regex-only
 *   OPENAI_API_KEY=sk-... npx tsx scripts/test-proxy-openai.ts --ner    # with NER (detects names)
 */

import {
  createRehydraFetch,
  InMemoryKeyProvider,
  InMemoryPIIStorageProvider,
  decryptPIIMap,
} from "../src/index.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY environment variable is required.");
  console.error("Usage: OPENAI_API_KEY=sk-... npx tsx scripts/test-proxy-openai.ts");
  process.exit(1);
}

async function main(): Promise<void> {
  console.log("=== OpenAI Proxy Integration Test ===\n");

  const storage = new InMemoryPIIStorageProvider();
  const keyProvider = new InMemoryKeyProvider();
  const sessionId = "openai-test";

  const nerMode = process.argv.includes("--ner") ? "quantized" as const : "disabled" as const;
  console.log(`NER mode: ${nerMode}${nerMode === "disabled" ? " (pass --ner to enable)" : ""}\n`);

  const rehydraFetch = createRehydraFetch({
    anonymizer: { ner: { mode: nerMode } },
    keyProvider,
    piiStorageProvider: storage,
    provider: "openai",
    getSessionId: async () => sessionId,
  });

  const prompt =
    "Write a very short confirmation (2 sentences max) that you received an email from John Smith at john.smith@acme-corp.com " +
    "about rescheduling a meeting. His phone number is +1-555-867-5309.";

  console.log("Prompt (with PII):");
  console.log(`  ${prompt}\n`);

  // --- Non-streaming request ---
  console.log("--- Non-streaming request ---\n");

  const response = await rehydraFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`OpenAI API error (${response.status}): ${errorBody}`);
    process.exit(1);
  }

  const data = await response.json() as any;
  const rehydratedResponse = data.choices[0].message.content;

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

  const streamSessionId = "openai-stream-test";
  const streamFetch = createRehydraFetch({
    anonymizer: { ner: { mode: nerMode } },
    keyProvider,
    piiStorageProvider: storage,
    provider: "openai",
    getSessionId: async () => streamSessionId,
    handleStreaming: true,
  });

  const streamResponse = await streamFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150,
      stream: true,
    }),
  });

  if (!streamResponse.ok) {
    const errorBody = await streamResponse.text();
    console.error(`OpenAI API error (${streamResponse.status}): ${errorBody}`);
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
    // Print raw SSE chunks for visibility
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        try {
          const parsed = JSON.parse(line.slice(6));
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) process.stdout.write(content);
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

  console.log("\n=== OpenAI proxy test complete ===");
}

main().catch(console.error);
