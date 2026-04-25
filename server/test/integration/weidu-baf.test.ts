/**
 * Integration tests for WeiDU BAF language features using real fixture files.
 *
 * BAF has limited AST-derived features (flat IF/THEN/RESPONSE/END blocks, no user-defined
 * constructs): folding ranges and formatting. Completion and hover are data-driven
 * (from static YAML) and tested via unit tests.
 *
 * Uses files from external/infinity-engine/ repos.
 */

import { join } from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { initParser, isInitialized, parseWithCache } from "../../../shared/parsers/weidu-baf";
import { formatWeiduBaf as formatDocument } from "@bgforge/format";
import { createFoldingRangesProvider } from "../../src/shared/folding-ranges";
import { SyntaxType } from "../../src/weidu-baf/tree-sitter.d";
import { loadFixture, IE_FIXTURES } from "./test-helpers";

const RR_BASE = join(IE_FIXTURES, "rr");

beforeAll(async () => {
    await initParser();
});

describe("weidu-baf integration", () => {
    // =========================================================================
    // Folding Ranges
    // =========================================================================

    describe("folding ranges", () => {
        const BAF_FOLDABLE_TYPES = new Set([SyntaxType.Block, SyntaxType.Response]);
        const getFoldingRanges = createFoldingRangesProvider(isInitialized, parseWithCache, BAF_FOLDABLE_TYPES);

        it("produces folding ranges for IF/THEN blocks", () => {
            const f = loadFixture(RR_BASE, "rr/rr_core/compile/rr#stl01.baf");

            const ranges = getFoldingRanges(f.text);
            expect(ranges).toHaveLength(4);
        });

        it("handles a larger BAF file with many blocks", () => {
            const f = loadFixture(RR_BASE, "rr/rr_upgr/compile/botsmith.baf");

            const ranges = getFoldingRanges(f.text);
            expect(ranges).toHaveLength(8);
        });
    });

    // =========================================================================
    // Formatting
    // =========================================================================

    describe("formatting", () => {
        it("formats a BAF file without errors", () => {
            const f = loadFixture(RR_BASE, "rr/rr_core/compile/rr#stl01.baf");

            const tree = parseWithCache(f.text);
            expect(tree!).not.toBeNull();

            const result = formatDocument(tree!.rootNode);
            expect(result.text).toBeTruthy();
            expect(result.text).toContain("IF");
            expect(result.text).toContain("THEN");
            expect(result.text).toContain("END");
        });

        it("produces idempotent output", () => {
            const f = loadFixture(RR_BASE, "rr/rr_core/compile/rr#stl01.baf");

            const tree1 = parseWithCache(f.text);
            const result1 = formatDocument(tree1!.rootNode);

            const tree2 = parseWithCache(result1.text);
            const result2 = formatDocument(tree2!.rootNode);

            expect(result2.text).toBe(result1.text);
        });

        it("formats a larger BAF file", () => {
            const f = loadFixture(RR_BASE, "rr/rr_upgr/compile/botsmith.baf");

            const tree = parseWithCache(f.text);
            expect(tree!).not.toBeNull();

            const result = formatDocument(tree!.rootNode);
            expect(result.text).toBeTruthy();
        });
    });
});
