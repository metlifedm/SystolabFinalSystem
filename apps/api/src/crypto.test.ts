import { describe, expect, it } from "vitest";
import { makeId, sha256, stableStringify } from "./utils/crypto.js";

describe("crypto utilities", () => {
  describe("sha256", () => {
    it("produces a 64-char hex string", () => {
      const hash = sha256("hello");
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it("is deterministic", () => {
      expect(sha256("systolab")).toBe(sha256("systolab"));
    });

    it("is sensitive to input changes", () => {
      expect(sha256("a")).not.toBe(sha256("b"));
    });

    it("produces known test vector for empty string", () => {
      expect(sha256("")).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      );
    });

    it("never stores or exposes raw MongoDB URIs (credential safety rule)", () => {
      const uri = "mongodb+srv://user:password@cluster.mongodb.net/systolab";
      const hashed = sha256(uri).slice(0, 16);
      expect(hashed).not.toContain("user");
      expect(hashed).not.toContain("password");
      expect(hashed).toHaveLength(16);
    });
  });

  describe("stableStringify", () => {
    it("sorts object keys alphabetically", () => {
      const result = stableStringify({ z: 1, a: 2, m: 3 });
      expect(result).toBe('{"a":2,"m":3,"z":1}');
    });

    it("sorts nested objects", () => {
      const result = stableStringify({ b: { y: 1, x: 2 }, a: 3 });
      expect(result).toBe('{"a":3,"b":{"x":2,"y":1}}');
    });

    it("preserves arrays and their element order", () => {
      const result = stableStringify({ arr: [3, 1, 2] });
      expect(result).toBe('{"arr":[3,1,2]}');
    });

    it("produces identical output for equal objects regardless of key insertion order", () => {
      const a = stableStringify({ x: 1, y: 2 });
      const b = stableStringify({ y: 2, x: 1 });
      expect(a).toBe(b);
    });

    it("handles primitives", () => {
      expect(stableStringify(42)).toBe("42");
      expect(stableStringify("hello")).toBe('"hello"');
      expect(stableStringify(null)).toBe("null");
    });
  });

  describe("makeId", () => {
    it("starts with the supplied prefix", () => {
      const id = makeId("test");
      expect(id.startsWith("test_")).toBe(true);
    });

    it("produces unique values", () => {
      const ids = new Set(Array.from({ length: 1000 }, () => makeId("x")));
      expect(ids.size).toBe(1000);
    });

    it("contains only alphanumeric characters after the prefix separator", () => {
      const id = makeId("scan");
      const suffix = id.slice("scan_".length);
      expect(suffix).toMatch(/^[a-f0-9]+$/);
    });

    it("respects different prefixes", () => {
      expect(makeId("inv").startsWith("inv_")).toBe(true);
      expect(makeId("wh").startsWith("wh_")).toBe(true);
      expect(makeId("plan").startsWith("plan_")).toBe(true);
    });
  });
});
