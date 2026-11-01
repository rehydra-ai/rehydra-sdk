/**
 * Regression tests for binary payloads in tool results.
 *
 * Scrubbing a match inside base64-encoded bytes produces invalid base64 and
 * providers reject the whole request (DeepInfra answers
 * "api_error: Non-base64 digit found"). Real case: a Playwright screenshot
 * returned by the `read` tool as `data:image/png;base64,...`, where a 5-digit
 * span matched POSTAL_CODE by chance.
 *
 * Binary payloads must reach the provider byte-for-byte, while text next to
 * them is still scrubbed.
 */

import { describe, it, expect } from "vitest";
import { createRehydraPluginV2 } from "../../src/opencode-plugin/plugin-v2.js";

// A secret made only of base64 characters, so it can legitimately appear
// inside an encoded payload.
const SECRET_IN_BASE64 = "c2VjcmV0VmFsdWUxMjM0NTY3ODkw";

// ~1 KB of valid-looking base64 that contains the secret in the middle.
const RAW_BASE64 = "iVBORw0KGgo".repeat(60) + SECRET_IN_BASE64 + "AAAA".repeat(30);
const DATA_URI = `data:image/png;base64,${RAW_BASE64}`;

type HookCallback = (event: unknown) => void | Promise<void>;
interface HookPair {
  name: string;
  callback: HookCallback;
}

function mockCtx(options: Record<string, unknown> = {}): {
  ctx: Parameters<ReturnType<typeof createRehydraPluginV2>["setup"]>[0];
  sessionHooks: HookPair[];
} {
  const sessionHooks: HookPair[] = [];
  const ctx = {
    app: { name: "opencode", version: "2.0.32" },
    location: { directory: "/test-dir" },
    options,
    session: {
      hook: async (name: string, callback: HookCallback): Promise<unknown> => {
        sessionHooks.push({ name, callback });
        return { dispose: async (): Promise<void> => {} };
      },
    },
    tool: {
      hook: async (): Promise<unknown> => ({ dispose: async (): Promise<void> => {} }),
    },
  } as unknown as Parameters<ReturnType<typeof createRehydraPluginV2>["setup"]>[0];
  return { ctx, sessionHooks };
}

function hookOf(list: HookPair[], name: string): HookCallback {
  const pair = list.find((p) => p.name === name);
  if (pair === undefined) throw new Error(`hook not registered: ${name}`);
  return pair.callback;
}

async function setup(): Promise<HookCallback> {
  const plugin = createRehydraPluginV2({ redactValues: [SECRET_IN_BASE64] });
  const mocked = mockCtx();
  await plugin.setup(mocked.ctx);
  return hookOf(mocked.sessionHooks, "context");
}

/** Builds a model request whose tool result carries an image plus some text. */
function imageRequest(uri: string, text: string): Record<string, unknown> {
  return {
    sessionID: "ses-binary",
    system: [] as Array<{ type: string; text: string }>,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-result",
            id: "call-1",
            result: {
              content: [
                { type: "text", text: "Image read successfully" },
                { type: "file", uri, mime: "image/png", name: "shot.png" },
              ],
              metadata: { truncated: false },
            },
          },
        ],
      },
    ],
  };
}

function toolResultUri(event: Record<string, unknown>): string {
  const messages = event.messages as Array<{ content: Array<Record<string, unknown>> }>;
  const result = messages[1]!.content[0]!.result as {
    content: Array<{ type: string; uri?: string }>;
  };
  return result.content[1]!.uri as string;
}

function textOf(event: Record<string, unknown>): string {
  const messages = event.messages as Array<{ content: Array<{ text?: string }> }>;
  return messages[0]!.content[0]!.text as string;
}

describe("binary payloads in tool results", () => {
  it("should leave a base64 data URI untouched", async () => {
    const context = await setup();
    const event = imageRequest(DATA_URI, "Look at the screenshot");

    await context(event);

    expect(toolResultUri(event)).toBe(DATA_URI);
  });

  it("should still scrub text next to the image", async () => {
    const context = await setup();
    const event = imageRequest(DATA_URI, `the token is ${SECRET_IN_BASE64}`);

    await context(event);

    expect(textOf(event)).not.toContain(SECRET_IN_BASE64);
    expect(textOf(event)).toContain("<PII");
  });

  it("should leave a raw base64 blob untouched", async () => {
    const context = await setup();
    const event = imageRequest(RAW_BASE64, "no secrets here");

    await context(event);

    expect(toolResultUri(event)).toBe(RAW_BASE64);
  });

  it("should still scrub the same value in short text", async () => {
    const context = await setup();
    const event = imageRequest(DATA_URI, SECRET_IN_BASE64);

    await context(event);

    expect(textOf(event)).not.toContain(SECRET_IN_BASE64);
  });

  it("should keep a data URI shorter than the raw-base64 threshold", async () => {
    const context = await setup();
    const shortUri = `data:image/gif;base64,${SECRET_IN_BASE64}`;

    const event = imageRequest(shortUri, "no secrets here");
    await context(event);

    expect(toolResultUri(event)).toBe(shortUri);
  });

  it("should keep a data URI with parameters and no media type", async () => {
    const context = await setup();
    const named = `data:image/png;name=shot.png;base64,${RAW_BASE64}`;
    const bare = `data:;base64,${RAW_BASE64}`;

    const namedEvent = imageRequest(named, "no secrets here");
    const bareEvent = imageRequest(bare, "no secrets here");
    await context(namedEvent);
    await context(bareEvent);

    expect(toolResultUri(namedEvent)).toBe(named);
    expect(toolResultUri(bareEvent)).toBe(bare);
  });

  it("should still scrub text that follows a data URI in the same string", async () => {
    const context = await setup();
    const mixed = `data:image/gif;base64,R0lGODlhAQABAAAAACw=\n\ntoken ${SECRET_IN_BASE64}`;

    const event = imageRequest(mixed, "no secrets here");
    await context(event);

    expect(toolResultUri(event)).not.toContain(SECRET_IN_BASE64);
    expect(toolResultUri(event)).toContain("<PII");
  });

  it("should still scrub a string that only resembles a data URI header", async () => {
    const context = await setup();
    const fake = `data: sent by ${SECRET_IN_BASE64};base64,R0lGODlhAQABAAAAACw=`;

    const event = imageRequest(fake, "no secrets here");
    await context(event);

    expect(toolResultUri(event)).not.toContain(SECRET_IN_BASE64);
  });
});
