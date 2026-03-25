/**
 * Tests for walkJson utility
 */

import { describe, it, expect } from "vitest";
import { walkJson } from "../../src/utils/json-walk.js";

describe("walkJson", () => {
  const upper = async (s: string) => s.toUpperCase();

  it("should transform string values", async () => {
    const result = await walkJson("hello", upper);
    expect(result).toBe("HELLO");
  });

  it("should pass through null", async () => {
    const result = await walkJson(null, upper);
    expect(result).toBeNull();
  });

  it("should pass through undefined", async () => {
    const result = await walkJson(undefined, upper);
    expect(result).toBeUndefined();
  });

  it("should pass through numbers", async () => {
    expect(await walkJson(42, upper)).toBe(42);
    expect(await walkJson(0, upper)).toBe(0);
    expect(await walkJson(-1.5, upper)).toBe(-1.5);
  });

  it("should pass through booleans", async () => {
    expect(await walkJson(true, upper)).toBe(true);
    expect(await walkJson(false, upper)).toBe(false);
  });

  it("should transform strings in a flat object", async () => {
    const result = await walkJson({ a: "hello", b: "world" }, upper);
    expect(result).toEqual({ a: "HELLO", b: "WORLD" });
  });

  it("should preserve non-string values in objects", async () => {
    const result = await walkJson(
      { name: "alice", age: 30, active: true, data: null },
      upper,
    );
    expect(result).toEqual({
      name: "ALICE",
      age: 30,
      active: true,
      data: null,
    });
  });

  it("should transform strings in arrays", async () => {
    const result = await walkJson(["hello", "world"], upper);
    expect(result).toEqual(["HELLO", "WORLD"]);
  });

  it("should handle arrays with mixed types", async () => {
    const result = await walkJson(["hello", 42, true, null, "world"], upper);
    expect(result).toEqual(["HELLO", 42, true, null, "WORLD"]);
  });

  it("should handle deeply nested structures", async () => {
    const input = {
      level1: {
        level2: {
          level3: {
            value: "deep",
          },
        },
        list: [{ name: "alice" }, { name: "bob" }],
      },
    };
    const result = await walkJson(input, upper);
    expect(result).toEqual({
      level1: {
        level2: {
          level3: {
            value: "DEEP",
          },
        },
        list: [{ name: "ALICE" }, { name: "BOB" }],
      },
    });
  });

  it("should handle empty objects and arrays", async () => {
    expect(await walkJson({}, upper)).toEqual({});
    expect(await walkJson([], upper)).toEqual([]);
  });

  it("should return a deep copy (not mutate input)", async () => {
    const input = { a: "hello", nested: { b: "world" } };
    const result = await walkJson(input, upper);
    expect(result).toEqual({ a: "HELLO", nested: { b: "WORLD" } });
    expect(input).toEqual({ a: "hello", nested: { b: "world" } });
    expect(result).not.toBe(input);
    expect(result.nested).not.toBe(input.nested);
  });

  it("should process strings sequentially", async () => {
    const order: string[] = [];
    const trackOrder = async (s: string) => {
      order.push(s);
      return s.toUpperCase();
    };

    await walkJson({ a: "first", b: "second", c: "third" }, trackOrder);
    expect(order).toEqual(["first", "second", "third"]);
  });

  it("should process array elements sequentially", async () => {
    const order: string[] = [];
    const trackOrder = async (s: string) => {
      order.push(s);
      return s.toUpperCase();
    };

    await walkJson(["a", "b", "c"], trackOrder);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("should handle empty strings", async () => {
    const result = await walkJson({ a: "" }, upper);
    expect(result).toEqual({ a: "" });
  });
});
