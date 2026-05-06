/**
 * Editor graceful-map auto-fallback contract.
 *
 * The editor's purpose is best-effort display. The CLI's purpose is batch
 * verification. Same library, different jobs — so when a `.map` strict
 * parse returns errors that prevent display, the editor retries with
 * `gracefulMapBoundaries: true` while the CLI surfaces the error. Without
 * this fallback, opening sfsheng.map (and similar ambiguous-boundary
 * files) in the editor produces a blank/error tree the user cannot act on.
 *
 * Contract: `parseForEditor(parser, bytes, filePath)` strict-parses first;
 * on `.map` files with errors, retries permissively. Returns the actual
 * options used so downstream reparses (incremental edits, revert) reuse
 * the same shape — otherwise editing a graceful-loaded map would
 * silently re-fail at the next byte rebuild.
 */

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { mapParser } from "@bgforge/binary";
import { parseForEditor } from "../src/editors/binaryEditor-parse";

const FIXTURE_MAPS = path.resolve("client/testFixture/maps");

function fixtureBytes(name: string): Uint8Array {
    return new Uint8Array(fs.readFileSync(path.join(FIXTURE_MAPS, name)));
}

describe("parseForEditor: graceful-map auto-fallback", () => {
    it("strict-parses a clean fixture and returns base (non-graceful) options", () => {
        // arcaves.map parses strict cleanly, so the fallback never fires
        // and the returned options must NOT carry gracefulMapBoundaries.
        const filePath = path.join(FIXTURE_MAPS, "arcaves.map");
        const outcome = parseForEditor(mapParser, fixtureBytes("arcaves.map"), filePath);
        expect(outcome.parseResult.errors ?? []).toEqual([]);
        expect(outcome.parseOptions?.gracefulMapBoundaries).toBeUndefined();
    });

    it("falls back to graceful when strict parse returns errors", () => {
        // sfsheng.map has an ambiguous script/object boundary; strict parse
        // errors, graceful succeeds. The editor must end up with a usable
        // tree, not an error stub.
        const filePath = path.join(FIXTURE_MAPS, "sfsheng.map");
        const outcome = parseForEditor(mapParser, fixtureBytes("sfsheng.map"), filePath);
        expect(outcome.parseResult.errors ?? []).toEqual([]);
        expect(outcome.parseOptions?.gracefulMapBoundaries).toBe(true);
    });

    it("preserves file-derived options (pidResolver) across the fallback", () => {
        // The graceful retry must keep the sibling-proto resolver — losing
        // it would mean falling into the unresolved-pid opaque-tail bail
        // for any modded items in the file, defeating step 1's fix.
        const filePath = path.join(FIXTURE_MAPS, "sfsheng.map");
        const outcome = parseForEditor(mapParser, fixtureBytes("sfsheng.map"), filePath);
        expect(outcome.parseOptions?.pidResolver).toBeDefined();
    });

    it("does NOT engage the fallback for non-.map extensions", () => {
        // .pro and other formats have no graceful-boundaries notion; their
        // errors must surface unchanged.
        const fakeProBytes = new Uint8Array([1, 2, 3]);
        const outcome = parseForEditor(
            mapParser, // any parser; we just need to observe non-.map path
            fakeProBytes,
            "/some/where/file.pro",
        );
        expect(outcome.parseOptions?.gracefulMapBoundaries).toBeUndefined();
    });
});
