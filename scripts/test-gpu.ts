#!/usr/bin/env npx tsx
/**
 * GPU Performance Test Script
 * Tests CUDA and TensorRT inference on NVIDIA GPUs (T4, V100, A100, etc.)
 * 
 * Usage:
 *   npx tsx scripts/test-gpu.ts
 *   npx tsx scripts/test-gpu.ts --device cuda
 *   npx tsx scripts/test-gpu.ts --device tensorrt
 *   npx tsx scripts/test-gpu.ts --compare  # Compare CPU vs CUDA vs TensorRT
 */

import { createAnonymizer, type NERConfig } from "../src/index.js";
import type { DeviceType } from "../src/ner/onnx-runtime.js";

// Test texts of varying complexity
const TEST_TEXTS = {
  short: "Contact John Smith at john.smith@example.com for more information.",
  
  medium: `Dear Dr. Maria Garcia,

Thank you for your inquiry regarding the project timeline. 
Please reach out to our Paris office at +33 1 42 68 53 00 or email support@acme-corp.fr.
Your account number is DE89 3704 0044 0532 0130 00.

Best regards,
Thomas Anderson
CEO, Acme Corporation`,

  long: `CONFIDENTIAL MEMO

From: Sarah Johnson, VP of Operations, Globex Industries
To: Executive Leadership Team
CC: Michael Chen (Legal), Dr. Emma Wilson (Compliance)

Subject: Q4 2025 Data Privacy Audit Results

Dear Team,

Following our comprehensive audit conducted between November 15-30, 2025, I am pleased to present the findings for our European operations.

Key Contacts Reviewed:
- Munich Office: Hans Mueller (hans.mueller@globex.de), +49 89 123 4567
- London Office: James Williams (j.williams@globex.co.uk), +44 20 7946 0958  
- Paris Office: Marie Dubois (m.dubois@globex.fr), +33 1 42 68 53 00

Financial Account References:
- Primary EUR Account: DE89 3704 0044 0532 0130 00 (Deutsche Bank)
- GBP Operations: GB82 WEST 1234 5698 7654 32 (NatWest)
- USD Transfers: Routed via JP Morgan Chase, Account ending 4521

Infrastructure Notes:
The primary data center (192.168.1.100) showed 99.97% uptime.
API Gateway: https://api.globex-internal.com/v2/customers
Customer Portal: https://portal.globex.com/login?user=admin

Credit cards on file for corporate expenses:
- 4532 0123 4567 8901 (Visa, expires 03/27)
- 5412 7534 9821 0046 (Mastercard, expires 11/26)

Please contact me at sarah.johnson@globex.com or my mobile +1 (555) 234-5678 to discuss.

Regards,
Sarah Johnson
Employee ID: EMP-2024-00142
SSN Reference: XXX-XX-1234 (last 4 only, per policy)`,
};

interface BenchmarkResult {
  device: DeviceType;
  textType: string;
  iterations: number;
  totalTimeMs: number;
  avgTimeMs: number;
  minTimeMs: number;
  maxTimeMs: number;
  entitiesFound: number;
  throughputTextsPerSec: number;
}

async function runBenchmark(
  device: DeviceType,
  textType: keyof typeof TEST_TEXTS,
  iterations: number = 10,
  warmupIterations: number = 3
): Promise<BenchmarkResult> {
  const text = TEST_TEXTS[textType];
  
  console.log(`\n🔧 Setting up ${device.toUpperCase()} inference...`);
  
  const nerConfig: NERConfig = {
    mode: "quantized",
    device,
    autoDownload: true,
    onStatus: (status) => console.log(`   ${status}`),
  };

  // Add TensorRT cache path for T4
  if (device === "tensorrt") {
    nerConfig.tensorrtCachePath = "/tmp/rehydra_trt_cache";
  }

  const anonymizer = createAnonymizer({ ner: nerConfig });
  
  console.log(`   Initializing model on ${device}...`);
  const initStart = performance.now();
  await anonymizer.initialize();
  const initTime = performance.now() - initStart;
  console.log(`   ✓ Model loaded in ${initTime.toFixed(0)}ms`);

  // Warmup runs (not counted)
  console.log(`   Warming up (${warmupIterations} iterations)...`);
  for (let i = 0; i < warmupIterations; i++) {
    await anonymizer.anonymize(text);
  }

  // Benchmark runs
  console.log(`   Running benchmark (${iterations} iterations)...`);
  const times: number[] = [];
  let entitiesFound = 0;

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const result = await anonymizer.anonymize(text);
    const elapsed = performance.now() - start;
    times.push(elapsed);
    entitiesFound = result.entities.length;
  }

  await anonymizer.dispose();

  const totalTimeMs = times.reduce((a, b) => a + b, 0);
  const avgTimeMs = totalTimeMs / iterations;
  const minTimeMs = Math.min(...times);
  const maxTimeMs = Math.max(...times);
  const throughputTextsPerSec = 1000 / avgTimeMs;

  return {
    device,
    textType,
    iterations,
    totalTimeMs,
    avgTimeMs,
    minTimeMs,
    maxTimeMs,
    entitiesFound,
    throughputTextsPerSec,
  };
}

function printResult(result: BenchmarkResult): void {
  console.log(`
┌────────────────────────────────────────────────────┐
│ ${result.device.toUpperCase().padEnd(10)} | ${result.textType.padEnd(8)} text                    │
├────────────────────────────────────────────────────┤
│ Avg Time:      ${result.avgTimeMs.toFixed(2).padStart(8)} ms                     │
│ Min Time:      ${result.minTimeMs.toFixed(2).padStart(8)} ms                     │
│ Max Time:      ${result.maxTimeMs.toFixed(2).padStart(8)} ms                     │
│ Throughput:    ${result.throughputTextsPerSec.toFixed(1).padStart(8)} texts/sec              │
│ Entities:      ${String(result.entitiesFound).padStart(8)}                        │
└────────────────────────────────────────────────────┘`);
}

function printComparison(results: BenchmarkResult[]): void {
  const cpuResult = results.find((r) => r.device === "cpu");
  
  console.log("\n📊 COMPARISON SUMMARY");
  console.log("═".repeat(60));
  
  for (const result of results) {
    const speedup = cpuResult ? cpuResult.avgTimeMs / result.avgTimeMs : 1;
    const speedupStr = result.device === "cpu" 
      ? "(baseline)" 
      : `${speedup.toFixed(2)}x faster`;
    
    console.log(
      `${result.device.toUpperCase().padEnd(10)} │ ` +
      `${result.avgTimeMs.toFixed(2).padStart(8)} ms │ ` +
      `${result.throughputTextsPerSec.toFixed(1).padStart(6)} texts/sec │ ` +
      `${speedupStr}`
    );
  }
  console.log("═".repeat(60));
}

async function checkGPUAvailable(): Promise<boolean> {
  try {
    // Try to import onnxruntime-node-gpu
    await import("onnxruntime-node-gpu");
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const compareMode = args.includes("--compare");
  const deviceArg = args.find((a) => a.startsWith("--device="))?.split("=")[1] as DeviceType | undefined;
  const device: DeviceType = deviceArg ?? "cuda";
  const textType = (args.find((a) => a.startsWith("--text="))?.split("=")[1] ?? "medium") as keyof typeof TEST_TEXTS;
  const iterations = parseInt(args.find((a) => a.startsWith("--iterations="))?.split("=")[1] ?? "10", 10);

  console.log("╔════════════════════════════════════════════════════════╗");
  console.log("║          REHYDRA GPU PERFORMANCE TEST                  ║");
  console.log("╚════════════════════════════════════════════════════════╝");

  // Check GPU availability
  const gpuAvailable = await checkGPUAvailable();
  
  if (!gpuAvailable && (device !== "cpu" || compareMode)) {
    console.error(`
❌ GPU runtime not available!

To use GPU acceleration, install onnxruntime-node-gpu:
  npm install onnxruntime-node-gpu

Requirements:
  - NVIDIA GPU with CUDA support (T4, V100, A100, etc.)
  - CUDA 11.x or 12.x installed
  - cuDNN 8.x installed
  - Node.js (not Bun) for GPU support
`);
    process.exit(1);
  }

  console.log(`\n📋 Test Configuration:`);
  console.log(`   Text type:   ${textType} (${TEST_TEXTS[textType].length} chars)`);
  console.log(`   Iterations:  ${iterations}`);
  console.log(`   Mode:        ${compareMode ? "CPU vs CUDA vs TensorRT comparison" : device.toUpperCase()}`);

  if (compareMode) {
    // Run comparison across all devices
    const results: BenchmarkResult[] = [];
    
    console.log("\n" + "─".repeat(60));
    console.log("Running CPU baseline...");
    results.push(await runBenchmark("cpu", textType, iterations));
    printResult(results[results.length - 1]);

    console.log("\n" + "─".repeat(60));
    console.log("Running CUDA...");
    results.push(await runBenchmark("cuda", textType, iterations));
    printResult(results[results.length - 1]);

    console.log("\n" + "─".repeat(60));
    console.log("Running TensorRT (first run builds engine cache)...");
    results.push(await runBenchmark("tensorrt", textType, iterations));
    printResult(results[results.length - 1]);

    printComparison(results);
  } else {
    // Run single device test
    const result = await runBenchmark(device, textType, iterations);
    printResult(result);
  }

  console.log("\n✅ Test complete!");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

