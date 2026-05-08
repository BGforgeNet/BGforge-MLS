/**
 * Pins the public surface of @bgforge/format against the symbols its
 * consumers (BGforge MLS server providers, fgfmt CLI, grammar format-check
 * harness) actually import. Adding a new public symbol requires extending
 * this list; removing one fails this test before downstream callers see
 * the break.
 */

import { describe, it, expect } from "vitest";
import * as format from "@bgforge/format";

const REQUIRED_VALUE_EXPORTS = [
    // Format-pipeline helpers
    "stripBom",
    "validateFormatting",
    "stripCommentsWeidu",
    "stripCommentsFalloutSsl",
    "stripCommentsTra",
    "stripCommentsFalloutMsg",
    "stripComments2da",
    "stripCommentsFalloutScriptsLst",
    "tokenizeWeidu",
    "normalizeWhitespaceWeidu",
    "throwOnParseError",
    "WeiduTokenType",
    // Editorconfig discovery
    "getEditorconfigSettings",
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
    // TP2 types and constants
    "weiduTp2DefaultOptions",
    "KW_BEGIN",
    "KW_END",
    // TP2 utilities
    "normalizeLineComment",
    "normalizeBlockComment",
    "normalizeComment",
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

describe("@bgforge/format public API", () => {
    for (const name of REQUIRED_VALUE_EXPORTS) {
        it(`exports ${name}`, () => {
            expect((format as Record<string, unknown>)[name]).toBeDefined();
        });
    }
});
