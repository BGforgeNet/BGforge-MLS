/**
 * Parity contract: the editor's parse path must apply every file-derived
 * `ParseOptions` axis the CLI applies. The two frontends compose options
 * independently; this test catches divergence the next time someone adds a
 * file-derived behavior to one but forgets the other.
 *
 * The shared library function `buildFileDerivedParseOptions(filePath)` is
 * the single source of truth for that axis. The editor's option builder
 * (`buildEditorParseOptions`) MUST delegate to it, layering the editor's
 * own preference axis (`skipMapTiles: true`) on top.
 *
 * The concrete failure this would have caught: gecksetl.map decoded as
 * 43,838 lines through the editor's "Dump to JSON" while the CLI produced
 * 146,293 lines on the same file — because the editor's `getParseOptions`
 * never picked up the sibling-proto/ auto-load added to the CLI.
 */

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { mapParser, type ParseResult } from "@bgforge/binary";
import { buildEditorParseOptions } from "../src/editors/binaryEditor-parseOptions";

const FIXTURE_MAPS = path.resolve("client/testFixture/maps");

function parseFixture(name: string): ParseResult {
    const filePath = path.join(FIXTURE_MAPS, name);
    const opts = buildEditorParseOptions(filePath);
    const bytes = new Uint8Array(fs.readFileSync(filePath));
    return mapParser.parse(bytes, opts);
}

describe("editor parse parity with CLI for .map files", () => {
    it("buildEditorParseOptions applies the file-derived pidResolver for .map", () => {
        // arcaves.map sits in client/testFixture/maps/, so the sibling proto/
        // auto-load points at client/testFixture/proto/. The editor MUST pick
        // up the same resolver the CLI does.
        const opts = buildEditorParseOptions(path.join(FIXTURE_MAPS, "arcaves.map"));
        expect(opts).toBeDefined();
        expect(opts!.pidResolver).toBeDefined();
        // Editor's preference axis: tile materialization off for tree perf.
        expect(opts!.skipMapTiles).toBe(true);
    });

    it("buildEditorParseOptions returns undefined for non-.map paths", () => {
        const opts = buildEditorParseOptions("/some/where/file.pro");
        expect(opts).toBeUndefined();
    });

    it("a fixture map that fully decodes via the CLI also fully decodes via the editor", () => {
        // arcaves.json (the CLI snapshot) has zero objects-tail opaque ranges,
        // proving the CLI fully decodes it. The editor's parse path must
        // match — divergence would mean the resolver wasn't applied and the
        // section bailed to opaque bytes.
        const result = parseFixture("arcaves.map");
        const objectsTail = result.opaqueRanges?.some((r) => r.label === "objects-tail");
        expect(objectsTail).toBe(false);
        expect(result.errors ?? []).toEqual([]);
    });
});
