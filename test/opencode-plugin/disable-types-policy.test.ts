/**
 * disableTypes keeps the types the user enabled (#118).
 *
 * A non-empty disableTypes used to rebuild regexEnabledTypes from the stock
 * defaults, dropping types enabled in policy or anonymizer.defaultPolicy,
 * such as types handled by a custom registry.
 */

import { describe, expect, it } from "vitest";
import { createRehydraPluginV2 } from "../../src/opencode-plugin/plugin-v2.js";
import { createDefaultPolicy, createDefaultRegistry, DetectionSource, PIIType } from "../../src/index.js";
import type { RehydraPluginOptions } from "../../src/opencode-plugin/types.js";

const NATIONAL_ID = "NID-482913";
const TEXT = `ID ${NATIONAL_ID}, see https://example.com/page`;

function registryWithNationalId(): ReturnType<typeof createDefaultRegistry> {
  const registry = createDefaultRegistry();
  registry.register({
    type: PIIType.NATIONAL_ID,
    name: "Test national ID",
    defaultConfidence: 0.9,
    find(text) {
      return [...text.matchAll(/NID-\d{6}/g)].map((m) => ({
        type: PIIType.NATIONAL_ID,
        start: m.index!,
        end: m.index! + m[0].length,
        confidence: 0.9,
        source: DetectionSource.REGEX,
        text: m[0],
      }));
    },
  });
  return registry;
}

function regexTypesWith(type: PIIType): Set<PIIType> {
  return new Set([...createDefaultPolicy().regexEnabledTypes, type]);
}

async function scrub(options: RehydraPluginOptions): Promise<string> {
  let context: ((event: unknown) => void | Promise<void>) | undefined;
  await createRehydraPluginV2(options).setup({
    app: { name: "opencode", version: "2.2.5" },
    location: { directory: "/test" },
    options: {},
    session: {
      hook: async (name: string, callback: (event: unknown) => void | Promise<void>): Promise<unknown> => {
        if (name === "context") context = callback;
        return { dispose: async (): Promise<void> => {} };
      },
    },
    tool: { hook: async (): Promise<unknown> => ({ dispose: async (): Promise<void> => {} }) },
  });
  const part = { type: "text", text: TEXT };
  await context!({ sessionID: "ses-1", system: [], messages: [{ role: "user", content: [part] }] });
  return part.text;
}

describe("disableTypes with a user-configured policy", () => {
  it("should keep a type enabled in policy.regexEnabledTypes", async () => {
    const text = await scrub({
      disableTypes: ["URL", "IP_ADDRESS"],
      policy: { regexEnabledTypes: regexTypesWith(PIIType.NATIONAL_ID) },
      anonymizer: { registry: registryWithNationalId(), secrets: { enabled: false } },
    });

    expect(text).not.toContain(NATIONAL_ID);
    expect(text).toMatch(/<PII type="NATIONAL_ID"/);
    expect(text).toContain("https://example.com/page");
  });

  it("should keep a type enabled in anonymizer.defaultPolicy", async () => {
    const text = await scrub({
      disableTypes: ["URL", "IP_ADDRESS"],
      anonymizer: {
        registry: registryWithNationalId(),
        secrets: { enabled: false },
        defaultPolicy: { regexEnabledTypes: regexTypesWith(PIIType.NATIONAL_ID) },
      },
    });

    expect(text).toMatch(/<PII type="NATIONAL_ID"/);
    expect(text).toContain("https://example.com/page");
  });

  it("should still remove a disabled type from the user's list", async () => {
    const text = await scrub({
      disableTypes: ["NATIONAL_ID"],
      policy: { regexEnabledTypes: regexTypesWith(PIIType.NATIONAL_ID) },
      anonymizer: { registry: registryWithNationalId(), secrets: { enabled: false } },
    });

    expect(text).not.toMatch(/<PII type="NATIONAL_ID"/);
  });
});
