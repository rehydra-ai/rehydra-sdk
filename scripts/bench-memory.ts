#!/usr/bin/env npx tsx
/**
 * Benchmark: Streaming memory usage
 *
 * Generates ~500MB of text with PII and streams it through AnonymizerStream.
 * Monitors peak RSS to verify constant memory usage.
 *
 * Acceptance criteria: peak RSS < 200MB above baseline.
 *
 * Usage:
 *   npx tsx scripts/bench-memory.ts
 */

import { Readable, Writable } from "node:stream";
import { createAnonymizerStream } from "../src/streaming/stream-factory.js";

const TARGET_BYTES = 500 * 1024 * 1024; // 500 MB
const CHUNK_SIZE = 4096;
const SAMPLE_INTERVAL_MS = 50;

// Text templates with PII sprinkled in
const TEMPLATES = [
  "Dear customer, please contact john.smith@example.com for assistance. ",
  "Your order has been shipped to 123 Main Street. Call +41 79 123 45 67 for details. ",
  "Payment received via IBAN CH93 0076 2011 6238 5295 7. Thank you for your business. ",
  "Meeting scheduled with the sales team at headquarters. Reach us at support@company.org. ",
  "The quarterly report is ready for review. No PII in this sentence at all. ",
  "Invoice #12345 sent to billing@acme-corp.com on behalf of the finance department. ",
  "Please verify your identity using card ending in 4111 1111 1111 1111. ",
  "Server logs show access from IP 192.168.1.100 at the usual time today. ",
];

function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

/**
 * Generate a readable stream of ~targetBytes of text with PII.
 */
function createTextStream(targetBytes: number): Readable {
  let bytesGenerated = 0;
  let templateIdx = 0;

  return new Readable({
    read(size: number): void {
      if (bytesGenerated >= targetBytes) {
        this.push(null);
        return;
      }

      let chunk = "";
      while (chunk.length < Math.min(size, CHUNK_SIZE) && bytesGenerated < targetBytes) {
        const template = TEMPLATES[templateIdx % TEMPLATES.length]!;
        chunk += template;
        templateIdx++;
      }

      bytesGenerated += Buffer.byteLength(chunk);
      this.push(chunk);
    },
  });
}

/**
 * Null writable — discards all data (like /dev/null).
 */
function createNullSink(): Writable {
  return new Writable({
    write(_chunk: unknown, _encoding: string, callback: () => void): void {
      callback();
    },
  });
}

async function main(): Promise<void> {
  console.log("=== Streaming Memory Benchmark ===\n");
  console.log(`Target input size: ${formatMB(TARGET_BYTES)}`);

  // Force GC if available to get a clean baseline
  if (global.gc !== undefined) {
    global.gc();
  }

  const baselineRSS = process.memoryUsage().rss;
  console.log(`Baseline RSS: ${formatMB(baselineRSS)}\n`);

  // Create the stream (regex-only for speed — NER would be too slow for 500MB)
  const stream = await createAnonymizerStream({
    buffer: { minBufferSize: 256, overlapChars: 0, maxBufferSize: 8192 },
  });

  const input = createTextStream(TARGET_BYTES);
  const sink = createNullSink();

  // Sample memory usage periodically
  let peakRSS = baselineRSS;
  let samples = 0;

  const sampler = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > peakRSS) peakRSS = rss;
    samples++;
    if (samples % 20 === 0) {
      const elapsed = ((samples * SAMPLE_INTERVAL_MS) / 1000).toFixed(0);
      process.stdout.write(
        `\r  [${elapsed}s] Current RSS: ${formatMB(rss)} | Peak: ${formatMB(peakRSS)} | Delta: ${formatMB(peakRSS - baselineRSS)}`,
      );
    }
  }, SAMPLE_INTERVAL_MS);

  const startTime = performance.now();

  // Pipe: input → anonymizer → null sink
  await new Promise<void>((resolve, reject) => {
    input
      .pipe(stream)
      .pipe(sink)
      .on("finish", resolve)
      .on("error", reject);
  });

  clearInterval(sampler);

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
  const finalRSS = process.memoryUsage().rss;

  // Final sample
  if (finalRSS > peakRSS) peakRSS = finalRSS;

  const deltaRSS = peakRSS - baselineRSS;

  console.log("\n");
  console.log("Results:");
  console.log(`  Input size:    ${formatMB(TARGET_BYTES)}`);
  console.log(`  Time:          ${elapsed}s`);
  console.log(`  Throughput:    ${formatMB(TARGET_BYTES / parseFloat(elapsed))}/s`);
  console.log(`  Baseline RSS:  ${formatMB(baselineRSS)}`);
  console.log(`  Peak RSS:      ${formatMB(peakRSS)}`);
  console.log(`  Delta RSS:     ${formatMB(deltaRSS)}`);
  console.log(`  Entities:      ${stream.stats.totalEntities}`);
  console.log(`  Chunks:        ${stream.stats.chunksProcessed}`);
  console.log();

  const MAX_DELTA_MB = 200;
  const deltaMB = deltaRSS / 1024 / 1024;

  if (deltaMB < MAX_DELTA_MB) {
    console.log(`PASS: Peak memory delta ${deltaMB.toFixed(1)} MB < ${MAX_DELTA_MB} MB limit`);
  } else {
    console.log(`FAIL: Peak memory delta ${deltaMB.toFixed(1)} MB >= ${MAX_DELTA_MB} MB limit`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
