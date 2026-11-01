/**
 * Custom ID detection and the policy (#117).
 *
 * policy.customIdPatterns used to be accepted but never run, and recognizers
 * built with createCustomIdRecognizer were registered under CASE_ID whatever
 * type they emitted, so CUSTOMER_ID followed the CASE_ID switch.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createAnonymizer, createDefaultPolicy, PIIType } from "../../src/index.js";
import type { AnonymizationPolicy } from "../../src/types/index.js";

const ACME = { name: "ACME ref", pattern: /ACME-\d{6}/g, type: PIIType.CASE_ID };

function without(...types: PIIType[]): AnonymizationPolicy {
  const base = createDefaultPolicy();
  return { ...base, regexEnabledTypes: new Set([...base.regexEnabledTypes].filter((t) => !types.includes(t))) };
}

describe("custom ID detection", () => {
  const anonymizer = createAnonymizer({ secrets: { enabled: false } });
  const run = async (text: string, policy?: Partial<AnonymizationPolicy>): Promise<string> =>
    (await anonymizer.anonymize(text, undefined, policy)).anonymizedText;

  beforeAll(async () => {
    await anonymizer.initialize();
  });

  describe("policy.customIdPatterns", () => {
    it("should detect values matching a pattern", async () => {
      const text = await run("Reference ACME-123456 pending", { customIdPatterns: [ACME] });
      expect(text).toMatch(/^Reference <PII type="CASE_ID" id="\d+"\/> pending$/);
    });

    it("should assign each pattern's type", async () => {
      const text = await run("Client ACME-123456", {
        customIdPatterns: [{ ...ACME, type: PIIType.CUSTOMER_ID }],
      });
      expect(text).toMatch(/<PII type="CUSTOMER_ID"/);
    });

    it("should skip matches rejected by validate", async () => {
      const text = await run("Reference ACME-000000 and ACME-123456", {
        customIdPatterns: [{ ...ACME, validate: (match: string) => !match.endsWith("000000") }],
      });
      expect(text).toContain("ACME-000000");
      expect(text).not.toContain("ACME-123456");
    });

    it("should accept patterns without the global flag", async () => {
      const text = await run("ACME-111111 and ACME-222222", {
        customIdPatterns: [{ ...ACME, pattern: /ACME-\d{6}/ }],
      });
      expect(text).not.toMatch(/ACME-\d/);
    });

    it("should not run when the pattern's type is off for regex detection", async () => {
      const text = await run("Reference ACME-123456", { ...without(PIIType.CASE_ID), customIdPatterns: [ACME] });
      expect(text).toBe("Reference ACME-123456");
    });

    it("should run a custom type that is only in enabledTypes", async () => {
      const projectType = "PROJECT_CODE" as PIIType;
      const base = createDefaultPolicy();
      const text = await run("Budget for ACME-123456", {
        enabledTypes: new Set([...base.enabledTypes, projectType]),
        customIdPatterns: [{ ...ACME, type: projectType }],
      });
      expect(text).toMatch(/<PII type="PROJECT_CODE"/);
    });

    it("should only apply to the call it is passed to", async () => {
      await run("Reference ACME-123456", { customIdPatterns: [ACME] });
      expect(await run("Reference ACME-123456")).toBe("Reference ACME-123456");
    });
  });

  describe("customer numbers follow the CUSTOMER_ID switch", () => {
    const CUSTOMER = "Account: customer 12345678";

    it("should detect customer numbers by default", async () => {
      expect(await run(CUSTOMER)).toMatch(/<PII type="CUSTOMER_ID"/);
    });

    it("should stop when CUSTOMER_ID is off for regex detection", async () => {
      expect(await run(CUSTOMER, without(PIIType.CUSTOMER_ID))).toBe(CUSTOMER);
    });

    it("should keep detecting them when only CASE_ID is off", async () => {
      expect(await run(CUSTOMER, without(PIIType.CASE_ID))).toMatch(/<PII type="CUSTOMER_ID"/);
    });
  });
});
