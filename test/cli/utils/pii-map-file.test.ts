import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { savePIIMapFile, loadPIIMapFile, type PIIMapFile } from "../../../src/cli/utils/pii-map-file.js";

describe("pii-map-file", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "rehydra-cli-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true });
  });

  const makePIIMapFile = (overrides?: Partial<PIIMapFile>): PIIMapFile => ({
    version: 1,
    createdAt: "2026-03-21T10:00:00.000Z",
    key: "dGVzdGtleQ==",
    piiMap: {
      ciphertext: "encrypted-data",
      iv: "test-iv",
      authTag: "test-tag",
    },
    stats: {
      totalEntities: 2,
      countsByType: { EMAIL: 1, PHONE: 1 },
    },
    ...overrides,
  });

  it("should round-trip save and load", async () => {
    const filePath = join(testDir, "pii-map.json");
    const original = makePIIMapFile();

    await savePIIMapFile(filePath, original);
    const loaded = await loadPIIMapFile(filePath);

    expect(loaded.version).toBe(1);
    expect(loaded.key).toBe(original.key);
    expect(loaded.piiMap).toEqual(original.piiMap);
    expect(loaded.stats).toEqual(original.stats);
  });

  it("should save without key when not provided", async () => {
    const filePath = join(testDir, "pii-map.json");
    const data = makePIIMapFile({ key: undefined });

    await savePIIMapFile(filePath, data);
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    expect(parsed["key"]).toBeUndefined();
  });

  it("should throw on missing file", async () => {
    await expect(
      loadPIIMapFile(join(testDir, "nonexistent.json")),
    ).rejects.toThrow("PII map file not found");
  });

  it("should throw on invalid JSON", async () => {
    const filePath = join(testDir, "bad.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, "not json{}", "utf-8");

    await expect(loadPIIMapFile(filePath)).rejects.toThrow("Invalid JSON");
  });

  it("should throw on invalid format (wrong version)", async () => {
    const filePath = join(testDir, "wrong-version.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, JSON.stringify({ version: 99 }), "utf-8");

    await expect(loadPIIMapFile(filePath)).rejects.toThrow("Invalid PII map file format");
  });
});
