/**
 * Pins both entry points of @bgforge/format.
 *
 * `.` is the semver-committed surface: format a document, plus the pipeline needed to do that safely.
 * Adding a symbol there is a public commitment, so it has to be added here first.
 *
 * `./internal` is for in-repo callers (the server's TP2 provider, the test suites). It carries no
 * semver promise - it is pinned only so a symbol cannot silently move between the two doors, which
 * is what would turn a grammar-shaped helper back into a public commitment by accident.
 */

import { describe, it, expect } from "vitest";
import * as publicApi from "@bgforge/format";
import * as internalApi from "@bgforge/format/internal";

const PUBLIC_EXPORTS = [
    // Tree-based formatters
    "formatFalloutSsl",
    "formatWeiduBaf",
    "formatWeiduD",
    "formatWeiduTp2",
    // Pure-string formatters
    "formatTra",
    "formatMsg",
    "format2da",
    "formatScriptsLst",
    // Safety pipeline
    "stripBom",
    "throwOnParseError",
    "validateFormatting",
    // Per-language normalizers for the content guard
    "stripCommentsWeidu",
    "stripCommentsFalloutSsl",
    "stripCommentsForCompareFalloutSsl",
    "stripCommentsTra",
    "stripCommentsFalloutMsg",
    "stripComments2da",
    "stripCommentsFalloutScriptsLst",
    // Editorconfig discovery
    "getEditorconfigSettings",
] as const;

const INTERNAL_EXPORTS = [
    // Tilde-delimited string scanning
    "scanTildeDelimiter",
    // Comment normalizers
    "normalizeLineComment",
    "normalizeBlockComment",
    "normalizeComment",
    // TP2 defaults and keyword constants
    "weiduTp2DefaultOptions",
    "KW_BEGIN",
    "KW_END",
    // TP2 node predicates
    "normalizeWhitespace",
    "withNormalizedComment",
    "isAction",
    "isPatch",
    "isControlFlow",
    "isCopyAction",
    "isFunctionDef",
    "isFunctionCall",
    "isBodyContent",
] as const;

const names = (mod: object) => Object.keys(mod).sort();

describe("@bgforge/format public API", () => {
    it("exports exactly the committed surface", () => {
        expect(names(publicApi)).toEqual([...PUBLIC_EXPORTS].sort());
    });
});

describe("@bgforge/format/internal", () => {
    it("exports exactly the in-repo surface", () => {
        expect(names(internalApi)).toEqual([...INTERNAL_EXPORTS].sort());
    });

    it("keeps the two doors disjoint", () => {
        const overlap = names(internalApi).filter((n) => names(publicApi).includes(n));
        expect(overlap).toEqual([]);
    });
});
