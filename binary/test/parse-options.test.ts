/**
 * Shared file-derived ParseOptions builder.
 *
 * `buildFileDerivedParseOptions(filePath)` is the single source of truth for
 * the *file-derived* axis of `ParseOptions`: any setting whose value is a
 * function of where the file sits on disk (which sibling resources exist,
 * which mod tree it belongs to, etc.). Both the CLI and the editor call this
 * so a behavior added here propagates to every frontend.
 *
 * Frontend-preference axes (`skipMapTiles`, `gracefulMapBoundaries`) stay
 * out of this builder by design — those legitimately differ per caller.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { buildFileDerivedParseOptions } from "../src/parse-options";

const FIXTURES = path.resolve("client/testFixture/proto");

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fgbin-fdo-"));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeMapDirWithProto(): string {
    const mapsDir = path.join(tmpDir, "maps");
    const protoDir = path.join(tmpDir, "proto");
    fs.mkdirSync(mapsDir);
    fs.mkdirSync(path.join(protoDir, "items"), { recursive: true });
    fs.mkdirSync(path.join(protoDir, "scenery"), { recursive: true });
    fs.copyFileSync(path.join(FIXTURES, "items", "00000031.pro"), path.join(protoDir, "items", "00000031.pro"));
    fs.copyFileSync(path.join(FIXTURES, "scenery", "00000008.pro"), path.join(protoDir, "scenery", "00000008.pro"));
    return path.join(mapsDir, "fake.map");
}

describe("buildFileDerivedParseOptions", () => {
    it("returns empty options for a non-.map file path", () => {
        const opts = buildFileDerivedParseOptions("/some/where/file.pro");
        expect(opts.pidResolver).toBeUndefined();
        expect(opts.diagnostics).toBeUndefined();
    });

    it("returns empty options for a .map file with no sibling proto/ dir", () => {
        const mapsDir = path.join(tmpDir, "maps");
        fs.mkdirSync(mapsDir);
        const opts = buildFileDerivedParseOptions(path.join(mapsDir, "any.map"));
        expect(opts.pidResolver).toBeUndefined();
        expect(opts.diagnostics).toBeUndefined();
    });

    it("returns a pidResolver covering items from a sibling proto/items/", () => {
        const mapPath = makeMapDirWithProto();
        const opts = buildFileDerivedParseOptions(mapPath);
        expect(opts.pidResolver).toBeDefined();
        // 00000031.pro is a vanilla ammo proto (subType 4 / Ammo).
        expect(opts.pidResolver!(31)).toBe(4);
    });

    it("returns a pidResolver covering scenery from a sibling proto/scenery/", () => {
        const mapPath = makeMapDirWithProto();
        const opts = buildFileDerivedParseOptions(mapPath);
        // 00000008.pro is a vanilla door proto (subType 0 / Door); pid = (2<<24)|8.
        expect(opts.pidResolver!(0x02000008)).toBe(0);
    });

    it("layers proto/ overrides on top of the bundled vanilla defaults", () => {
        const mapPath = makeMapDirWithProto();
        const opts = buildFileDerivedParseOptions(mapPath);
        // pid 161 is a vanilla weapon in the bundled table → subType 3 (Weapon).
        // It is NOT in the temp proto dir, so this exercises fallback.
        expect(opts.pidResolver!(161)).toBe(3);
    });

    it("reports diagnostics so callers can log scan stats", () => {
        const mapPath = makeMapDirWithProto();
        const opts = buildFileDerivedParseOptions(mapPath);
        expect(opts.diagnostics).toBeDefined();
        expect(opts.diagnostics!.protoDir).toBe(path.join(tmpDir, "proto"));
        expect(opts.diagnostics!.stats.filesScanned).toBe(2);
        expect(opts.diagnostics!.stats.subtypesResolved).toBe(2);
        expect(opts.diagnostics!.stats.errors).toEqual([]);
    });

    it("returns empty options when sibling proto/ exists but has zero matching files", () => {
        const mapsDir = path.join(tmpDir, "maps");
        const protoDir = path.join(tmpDir, "proto");
        fs.mkdirSync(mapsDir);
        fs.mkdirSync(path.join(protoDir, "items"), { recursive: true });
        // Empty proto/items/ — filesScanned will be 0, no resolver attached.
        const opts = buildFileDerivedParseOptions(path.join(mapsDir, "any.map"));
        expect(opts.pidResolver).toBeUndefined();
        expect(opts.diagnostics).toBeUndefined();
    });
});
