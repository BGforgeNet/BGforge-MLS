/**
 * Unit tests for webview-assets.ts.
 * Mocks the fs module to avoid real file system reads.
 * Verifies caching behavior: each cache key is loaded only once per extension path.
 */

import { vi, describe, expect, it, beforeEach } from "vitest";

vi.mock("fs", () => ({
    readFileSync: vi.fn(),
}));

import * as fs from "fs";
import { getCachedHtmlAsset, getCachedJsAsset, generateNonce, inlineWebviewScript } from "../src/webview-assets";

const mockReadFileSync = vi.mocked(fs.readFileSync);

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Reset the module-level cache by re-importing would not work here,
    // so we rely on fresh mock return values with distinct content per test.
});

describe("getCachedHtmlAsset", () => {
    it("reads file content from disk on first call", () => {
        mockReadFileSync.mockReturnValue("<html>template</html>");

        // Use a unique cache key to avoid cross-test cache hits
        const result = getCachedHtmlAsset("html-test-1", "/ext", "some/path.html");
        expect(result).toBe("<html>template</html>");
        expect(mockReadFileSync).toHaveBeenCalledWith(expect.stringContaining("some/path.html"), "utf8");
    });

    it("returns cached content on second call without reading the file again", () => {
        mockReadFileSync.mockReturnValue("<html>cached</html>");

        getCachedHtmlAsset("html-test-2", "/ext", "some/path2.html");
        getCachedHtmlAsset("html-test-2", "/ext", "some/path2.html");

        // readFileSync should only be called once
        expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    });

    it("re-reads when extension path changes (cache miss on different extensionPath)", () => {
        mockReadFileSync.mockReturnValue("<html>new-ext</html>");

        // Same cache key but different extensionPath invalidates the cache
        getCachedHtmlAsset("html-test-3", "/ext-a", "some/path3.html");
        mockReadFileSync.mockReturnValue("<html>other-ext</html>");
        const result = getCachedHtmlAsset("html-test-3", "/ext-b", "some/path3.html");

        expect(result).toBe("<html>other-ext</html>");
        expect(mockReadFileSync).toHaveBeenCalledTimes(2);
    });
});

describe("getCachedJsAsset", () => {
    it("reads JS file content from disk on first call", () => {
        mockReadFileSync.mockReturnValue("console.log('hello');");

        const result = getCachedJsAsset("js-test-1", "/ext", "out/bundle.js");
        expect(result).toBe("console.log('hello');");
        expect(mockReadFileSync).toHaveBeenCalledWith(expect.stringContaining("out/bundle.js"), "utf8");
    });

    it("returns cached JS on repeated calls", () => {
        mockReadFileSync.mockReturnValue("const x = 1;");

        getCachedJsAsset("js-test-2", "/ext", "out/script.js");
        getCachedJsAsset("js-test-2", "/ext", "out/script.js");

        expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    });
});

describe("generateNonce", () => {
    it("returns a non-empty base64 string", () => {
        const nonce = generateNonce();
        expect(typeof nonce).toBe("string");
        expect(nonce.length).toBeGreaterThan(0);
    });

    it("returns a different value on each call", () => {
        // 16 random bytes -> 24 base64 chars; two calls must differ (collision
        // probability with 128-bit entropy is negligible).
        const a = generateNonce();
        const b = generateNonce();
        expect(a).not.toBe(b);
    });

    it("produces only base64 characters", () => {
        const nonce = generateNonce();
        // Standard base64 alphabet: A-Z a-z 0-9 + / = (padding)
        expect(/^[A-Za-z0-9+/]+=*$/.test(nonce)).toBe(true);
    });
});

describe("inlineWebviewScript", () => {
    it("replaces the script placeholder with the script content", () => {
        const html = "before /* __SCRIPT__ */ after";
        const result = inlineWebviewScript(html, "console.log('hi');", "abc123");
        expect(result).toContain("console.log('hi');");
        expect(result).not.toContain("/* __SCRIPT__ */");
    });

    it("replaces all {{nonce}} occurrences with the supplied nonce", () => {
        const html = '<script nonce="{{nonce}}"></script><style nonce="{{nonce}}"></style>';
        const result = inlineWebviewScript(html, "", "mynonce");
        expect(result).toBe('<script nonce="mynonce"></script><style nonce="mynonce"></style>');
    });

    it("inlines script verbatim - does not interpret $& as the matched string", () => {
        // String.prototype.replace treats $& as the matched text in a plain string
        // replacement. A script containing $& would splice the placeholder back in,
        // producing a syntax error. The function replacer form avoids this.
        const html = "/* __SCRIPT__ */";
        const scriptWithDollar = "var x = a + $& + b;";
        const result = inlineWebviewScript(html, scriptWithDollar, "n");
        expect(result).toBe("var x = a + $& + b;");
    });

    it("inlines script verbatim - does not interpret $$ in the bundle", () => {
        // $$ in a replacement string collapses to a single $. A minified bundle
        // containing $$ would be silently mutated if a string replacement were used.
        const html = "/* __SCRIPT__ */";
        const scriptWithDouble = "var x = a$$b;";
        const result = inlineWebviewScript(html, scriptWithDouble, "n");
        expect(result).toBe("var x = a$$b;");
    });
});
