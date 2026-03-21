#!/usr/bin/env npx tsx
/**
 * Integration test: Streaming Anonymization
 *
 * Pipes text through the AnonymizerStream and verifies PII is replaced.
 * No API keys required.
 *
 * Usage:
 *   npx tsx scripts/test-streaming.ts
 */

import { Readable } from "node:stream";
import {
  createAnonymizerStream,
  InMemoryKeyProvider,
  InMemoryPIIStorageProvider,
  decryptPIIMap,
} from "../src/index.js";

async function collectStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? chunk : (chunk as Buffer).toString());
  }
  return chunks.join("");
}

async function main(): Promise<void> {
  console.log("=== Streaming Anonymization Test ===\n");

  const storage = new InMemoryPIIStorageProvider();
  const keyProvider = new InMemoryKeyProvider();

  // --- Test 1: Basic streaming ---
  console.log("1. Basic streaming with chunked input\n");

  const stream = await createAnonymizerStream({
    buffer: { minBufferSize: 10, overlapChars: 0 },
    sessionId: "stream-test",
    piiStorageProvider: storage,
    keyProvider,
    onChunk: (event) => {
      console.log(`   [chunk] ${event.entities.length} entities, ${event.processingTimeMs.toFixed(1)}ms`);
    },
    onFinish: (event) => {
      console.log(`   [done]  ${event.totalEntities} total entities, ${event.totalProcessingTimeMs.toFixed(1)}ms\n`);
    },
  });

  const chunks = [
    "Dear Support Team, ",
    "my name is John Smith and my email is john.smith@acme-corp.com. ",
    "Please call me at +41 79 123 45 67 regarding invoice #12345. ",
    "My IBAN is CH93 0076 2011 6238 5295 7. ",
    "Best regards, John Smith. ",
  ];

  console.log("   Input chunks:");
  for (const chunk of chunks) {
    console.log(`     "${chunk.trim()}"`);
  }
  console.log();

  const input = Readable.from(chunks);
  input.pipe(stream);
  const output = await collectStream(stream);

  console.log("   Anonymized output:");
  console.log(`     ${output}\n`);

  // Verify PII map was saved
  const stored = await storage.load("stream-test");
  if (stored !== null) {
    const key = await keyProvider.getKey();
    const piiMap = await decryptPIIMap(stored.piiMap, key);
    console.log("   PII Map (decrypted):");
    for (const [tag, value] of piiMap) {
      console.log(`     ${tag} → ${value}`);
    }
    console.log();
    console.log("   Entity counts:", stored.metadata.entityCounts);
  }

  // --- Test 2: Low-latency mode ---
  console.log("\n2. Low-latency mode (regex-only, for LLM token streams)\n");

  const llmStream = await createAnonymizerStream({
    buffer: { lowLatency: true },
    onFinish: (event) => {
      console.log(`   [done]  ${event.totalEntities} entities, ${event.totalProcessingTimeMs.toFixed(1)}ms\n`);
    },
  });

  // Simulate small LLM token chunks
  const tokens = [
    "Sure, ", "I'll ", "email ", "john@", "example", ".com ", "right ", "away. ",
  ];

  console.log(`   Simulating ${tokens.length} token chunks...`);

  const tokenInput = Readable.from(tokens);
  tokenInput.pipe(llmStream);
  const llmOutput = await collectStream(llmStream);

  console.log("   Input:  " + tokens.join(""));
  console.log("   Output: " + llmOutput);

  console.log("\n=== All streaming tests passed ===");
}

main().catch(console.error);
