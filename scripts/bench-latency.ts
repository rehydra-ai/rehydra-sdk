#!/usr/bin/env npx tsx
/**
 * Benchmark: Proxy middleware latency overhead
 *
 * Measures the latency added by createRehydraFetch on top of a mock LLM server.
 * Uses regex-only mode (no NER) to isolate the proxy overhead.
 *
 * Acceptance criteria: middleware adds <5ms latency for non-NER anonymization.
 *
 * Usage:
 *   npx tsx scripts/bench-latency.ts
 */

import { createServer, type Server } from "node:http";
import { createRehydraFetch } from "../src/proxy/rehydra-fetch.js";
import { InMemoryKeyProvider } from "../src/crypto/index.js";
import { InMemoryPIIStorageProvider } from "../src/storage/in-memory.js";

const WARMUP_ROUNDS = 3;
const BENCH_ROUNDS = 20;

const PROMPT =
  "Please draft a reply to john.smith@acme-corp.com about rescheduling " +
  "the meeting. His phone is +1-555-867-5309 and his IBAN is CH93 0076 2011 6238 5295 7.";

/**
 * Create a minimal mock LLM server that responds as fast as possible.
 */
function startMockServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const responseBody = JSON.stringify({
      choices: [{
        message: { role: "assistant", content: "Got it, I will email them right away." },
      }],
    });

    const server = createServer(async (req, res) => {
      // Drain request body
      for await (const _ of req) { /* discard */ }

      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(responseBody)),
      });
      res.end(responseBody);
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

/**
 * Measure a single raw fetch round-trip (no rehydra).
 */
async function measureRawFetch(port: number): Promise<number> {
  const start = performance.now();

  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test",
      messages: [{ role: "user", content: PROMPT }],
    }),
  });
  await response.json();

  return performance.now() - start;
}

/**
 * Measure a single rehydra-wrapped fetch round-trip.
 */
async function measureRehydraFetch(
  rehydraFetch: typeof fetch,
  port: number,
): Promise<number> {
  const start = performance.now();

  const response = await rehydraFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "test",
      messages: [{ role: "user", content: PROMPT }],
    }),
  });
  await response.json();

  return performance.now() - start;
}

function stats(values: number[]): { median: number; p95: number; mean: number; min: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    median: sorted[Math.floor(sorted.length / 2)]!,
    p95: sorted[Math.floor(sorted.length * 0.95)]!,
  };
}

async function main(): Promise<void> {
  console.log("=== Proxy Latency Benchmark ===\n");
  console.log(`Prompt: "${PROMPT.slice(0, 60)}..."`);
  console.log(`Rounds: ${WARMUP_ROUNDS} warmup + ${BENCH_ROUNDS} measured\n`);

  const { server, port } = await startMockServer();

  // Create rehydra fetch (regex-only, no NER)
  let sessionCounter = 0;
  const rehydraFetch = createRehydraFetch({
    keyProvider: new InMemoryKeyProvider(),
    piiStorageProvider: new InMemoryPIIStorageProvider(),
    provider: "openai",
    getSessionId: async () => `bench-${++sessionCounter}`,
  });

  try {
    // --- Warmup ---
    console.log("Warming up...");
    for (let i = 0; i < WARMUP_ROUNDS; i++) {
      await measureRawFetch(port);
      await measureRehydraFetch(rehydraFetch, port);
    }

    // --- Benchmark raw fetch ---
    console.log("Measuring raw fetch...");
    const rawTimes: number[] = [];
    for (let i = 0; i < BENCH_ROUNDS; i++) {
      rawTimes.push(await measureRawFetch(port));
    }

    // --- Benchmark rehydra fetch ---
    console.log("Measuring rehydra fetch...");
    const rehydraTimes: number[] = [];
    for (let i = 0; i < BENCH_ROUNDS; i++) {
      rehydraTimes.push(await measureRehydraFetch(rehydraFetch, port));
    }

    // --- Results ---
    const rawStats = stats(rawTimes);
    const rehydraStats = stats(rehydraTimes);

    const overheadMedian = rehydraStats.median - rawStats.median;
    const overheadP95 = rehydraStats.p95 - rawStats.p95;

    console.log("\nResults:\n");
    console.log("  Raw fetch (baseline):");
    console.log(`    Median: ${rawStats.median.toFixed(2)}ms`);
    console.log(`    P95:    ${rawStats.p95.toFixed(2)}ms`);
    console.log(`    Range:  ${rawStats.min.toFixed(2)}ms - ${rawStats.max.toFixed(2)}ms`);

    console.log("\n  Rehydra fetch (regex-only, anonymize + rehydrate):");
    console.log(`    Median: ${rehydraStats.median.toFixed(2)}ms`);
    console.log(`    P95:    ${rehydraStats.p95.toFixed(2)}ms`);
    console.log(`    Range:  ${rehydraStats.min.toFixed(2)}ms - ${rehydraStats.max.toFixed(2)}ms`);

    console.log("\n  Overhead (rehydra - raw):");
    console.log(`    Median: ${overheadMedian.toFixed(2)}ms`);
    console.log(`    P95:    ${overheadP95.toFixed(2)}ms`);

    const MAX_OVERHEAD_MS = 5;
    console.log();

    if (overheadMedian < MAX_OVERHEAD_MS) {
      console.log(`PASS: Median overhead ${overheadMedian.toFixed(2)}ms < ${MAX_OVERHEAD_MS}ms limit`);
    } else {
      console.log(`FAIL: Median overhead ${overheadMedian.toFixed(2)}ms >= ${MAX_OVERHEAD_MS}ms limit`);
      process.exit(1);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
