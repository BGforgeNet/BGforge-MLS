/**
 * SSL identifier case through the real parse -> index path.
 *
 * SSL binds its own constructs case-insensitively, so a header procedure is findable however a caller
 * spells it. Its preprocessor does not: sslc rejects `my_macro` against `#define MY_MACRO`, so a `#define`
 * name must stay exact even though everything around it folds.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";

vi.mock("../../src/diagnostics", () => ({
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

vi.mock("../../src/logger", () => ({
    conlog: vi.fn(),
}));

vi.mock("../../src/path-utils", () => ({
    findFiles: vi.fn(() => []),
}));

import { parseFile } from "../../src/fallout-ssl/header-parser";
import { initParser } from "../../../shared/parsers/fallout-ssl";
import { FileIndex } from "../../src/core/file-index";
import { normalizeUri } from "../../src/core/normalized-uri";
import { LANG_FALLOUT_SSL } from "../../../shared/languages";

const testUri = "file:///mymod/headers/test.h";
const workspaceRoot = "/mymod";

/** Index a header through the same parse the server runs on it. */
function indexHeader(text: string): FileIndex {
    const index = new FileIndex(LANG_FALLOUT_SSL);
    index.updateFile(normalizeUri(testUri), parseFile(testUri, text, workspaceRoot));
    return index;
}

describe("SSL name case through parse and index", () => {
    beforeAll(async () => {
        await initParser();
    });

    it("finds a header procedure under a different case", () => {
        const index = indexHeader("procedure NOde005;");

        expect(index.symbols.lookup("node005")?.name).toBe("NOde005");
    });

    it("does not find a parameterless #define under a different case", () => {
        const index = indexHeader("#define MY_CONST 5");

        expect(index.symbols.lookup("MY_CONST")?.name).toBe("MY_CONST");
        expect(index.symbols.lookup("my_const")).toBeUndefined();
    });

    it("does not find a macro #define under a different case", () => {
        const index = indexHeader("#define MY_MACRO(X) display_msg(X)");

        expect(index.symbols.lookup("MY_MACRO")?.name).toBe("MY_MACRO");
        expect(index.symbols.lookup("my_macro")).toBeUndefined();
    });
});
