/**
 * Unit tests for shared dialog tree utilities (escapeHtml).
 * Covers all five HTML metacharacters including single quotes.
 */

import { vi, describe, expect, it } from "vitest";

vi.mock("vscode", () => ({}));
vi.mock("vscode-languageclient/node", () => ({}));

import { escapeHtml } from "../src/dialog-tree/shared";

describe("escapeHtml", () => {
    it("escapes ampersands", () => {
        expect(escapeHtml("a&b")).toBe("a&amp;b");
    });

    it("escapes less-than", () => {
        expect(escapeHtml("a<b")).toBe("a&lt;b");
    });

    it("escapes greater-than", () => {
        expect(escapeHtml("a>b")).toBe("a&gt;b");
    });

    it("escapes double quotes", () => {
        expect(escapeHtml('a"b')).toBe("a&quot;b");
    });

    it("escapes single quotes", () => {
        expect(escapeHtml("a'b")).toBe("a&#39;b");
    });

    it("escapes all five characters in one string", () => {
        expect(escapeHtml(`<div class="x" data-name='a&b'>`)).toBe(
            "&lt;div class=&quot;x&quot; data-name=&#39;a&amp;b&#39;&gt;",
        );
    });

    it("returns empty string unchanged", () => {
        expect(escapeHtml("")).toBe("");
    });

    it("returns plain text unchanged", () => {
        expect(escapeHtml("hello world")).toBe("hello world");
    });

    it("handles multiple consecutive special characters", () => {
        expect(escapeHtml("<<>>&&")).toBe("&lt;&lt;&gt;&gt;&amp;&amp;");
    });

    it("does not double-escape already escaped text", () => {
        // If you pass already-escaped text, it escapes the ampersands again
        expect(escapeHtml("&amp;")).toBe("&amp;amp;");
    });
});
