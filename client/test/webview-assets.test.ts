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
import { getCachedHtmlAsset, getCachedCssAsset, getCachedJsAsset } from "../src/webview-assets";

const mockReadFileSync = vi.mocked(fs.readFileSync);

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Reset the module-level cache by re-importing would not work here,
    // so we rely on fresh mock return values with distinct content per test.
});

describe("getCachedHtmlAsset", () => {
    it("reads file content from disk on first call", () => {
        mockReadFileSync.mockReturnValue("<html>template</html>" as unknown as Buffer);

        // Use a unique cache key to avoid cross-test cache hits
        const result = getCachedHtmlAsset("html-test-1", "/ext", "some/path.html");
        expect(result).toBe("<html>template</html>");
        expect(mockReadFileSync).toHaveBeenCalledWith(expect.stringContaining("some/path.html"), "utf8");
    });

    it("returns cached content on second call without reading the file again", () => {
        mockReadFileSync.mockReturnValue("<html>cached</html>" as unknown as Buffer);

        getCachedHtmlAsset("html-test-2", "/ext", "some/path2.html");
        getCachedHtmlAsset("html-test-2", "/ext", "some/path2.html");

        // readFileSync should only be called once
        expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    });

    it("re-reads when extension path changes (cache miss on different extensionPath)", () => {
        mockReadFileSync.mockReturnValue("<html>new-ext</html>" as unknown as Buffer);

        // Same cache key but different extensionPath invalidates the cache
        getCachedHtmlAsset("html-test-3", "/ext-a", "some/path3.html");
        mockReadFileSync.mockReturnValue("<html>other-ext</html>" as unknown as Buffer);
        const result = getCachedHtmlAsset("html-test-3", "/ext-b", "some/path3.html");

        expect(result).toBe("<html>other-ext</html>");
        expect(mockReadFileSync).toHaveBeenCalledTimes(2);
    });
});

describe("getCachedCssAsset", () => {
    it("concatenates multiple CSS files with newline separator", () => {
        mockReadFileSync
            .mockReturnValueOnce("body { color: red; }" as unknown as Buffer)
            .mockReturnValueOnce(".foo { display: block; }" as unknown as Buffer);

        const result = getCachedCssAsset("css-test-1", "/ext", ["a.css", "b.css"]);
        expect(result).toBe("body { color: red; }\n.foo { display: block; }");
        expect(mockReadFileSync).toHaveBeenCalledTimes(2);
    });

    it("returns cached CSS on repeated calls", () => {
        mockReadFileSync.mockReturnValue(".cached {}" as unknown as Buffer);

        getCachedCssAsset("css-test-2", "/ext", ["only.css"]);
        const result = getCachedCssAsset("css-test-2", "/ext", ["only.css"]);

        expect(result).toBe(".cached {}");
        expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    });
});

describe("getCachedJsAsset", () => {
    it("reads JS file content from disk on first call", () => {
        mockReadFileSync.mockReturnValue("console.log('hello');" as unknown as Buffer);

        const result = getCachedJsAsset("js-test-1", "/ext", "out/bundle.js");
        expect(result).toBe("console.log('hello');");
        expect(mockReadFileSync).toHaveBeenCalledWith(expect.stringContaining("out/bundle.js"), "utf8");
    });

    it("returns cached JS on repeated calls", () => {
        mockReadFileSync.mockReturnValue("const x = 1;" as unknown as Buffer);

        getCachedJsAsset("js-test-2", "/ext", "out/script.js");
        getCachedJsAsset("js-test-2", "/ext", "out/script.js");

        expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    });
});
