/**
 * Integration tests for the Translation service against real external corpus files.
 *
 * Two things unit tests (server/test/translation.test.ts) can't exercise on a hand-built
 * fixture: the startup consumer-index walk at real-corpus scale (bounded/async, not "tens of
 * files"), and legacy-codepage round-trip fidelity against a real, non-synthetic windows-1252
 * `.tra` file.
 */

import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { Translation } from "../../src/translation";
import type { ProjectTraSettings } from "../../src/settings";
import { findFilesByExtensions } from "../../src/path-utils";
import { CONSUMER_EXTENSIONS_TRA, CONSUMER_EXTENSIONS_MSG } from "../../../shared/languages";
import { IE_FIXTURES } from "./test-helpers";

const BGT_ROOT = join(IE_FIXTURES, "BGT-WeiDU");
const BGT_TRA_DIR = "bgt/language/english";

// A real, small (203-byte) windows-1252 `.tra` file from the corpus: Spanish text with accented
// characters (`¿`, `é`, `í`) that are not valid UTF-8 bytes, so it exercises the fallback decode
// path on genuine legacy-codepage content rather than a hand-typed fixture.
const CP1252_FIXTURE = join(IE_FIXTURES, "BG1NPC/bg1npc/tra/spanish/x#lp1r.tra");

describe.skipIf(!existsSync(BGT_ROOT))("translation integration: consumer index over a real corpus", () => {
    it("bounds and completes the startup consumer-index walk over a large real corpus", async () => {
        // Ground the ">tens of files" claim: how many real consumer-extension files this corpus
        // alone carries, via the exact same discovery helper buildConsumerIndex uses internally.
        const scanned = await findFilesByExtensions(BGT_ROOT, [...CONSUMER_EXTENSIONS_TRA, ...CONSUMER_EXTENSIONS_MSG]);
        expect(scanned.length).toBeGreaterThan(500);

        const settings: ProjectTraSettings = { directory: BGT_TRA_DIR, auto_tra: true };
        const t = new Translation(settings, BGT_ROOT);

        // Must complete (not hang, not throw) walking `scanned.length` consumer files through the
        // WORKSPACE_SCAN_CONCURRENCY-bounded async fan-out. The synchronous unbounded loop this
        // replaced would also finish here (this corpus is not large enough to time out either
        // way) - what this proves is correctness at real scale; non-blocking is structural
        // (the bounded pLimit fan-out itself), not something a single init() call observes.
        await t.init();
        expect(t.initialized).toBe(true);
    });
});

describe.skipIf(!existsSync(CP1252_FIXTURE))("translation integration: real windows-1252 fixture", () => {
    it("resolves the accented glyphs from a real windows-1252 .tra file", async () => {
        const raw = readFileSync(CP1252_FIXTURE);
        expect(() => new TextDecoder("utf-8", { fatal: true }).decode(raw)).toThrow();

        const dir = mkdtempSync(join(tmpdir(), "mls-encoding-it-"));
        try {
            copyFileSync(CP1252_FIXTURE, join(dir, "x#lp1r.tra"));
            writeFileSync(join(dir, "x#lp1r.tbaf"), "");

            const settings: ProjectTraSettings = { directory: dir, auto_tra: true };
            const t = new Translation(settings, dir);
            await t.init();

            // No @tra comment needed: `#` is not a word character (see docs/settings.md), so the
            // directive can't name this file - auto_tra's basename match ("x#lp1r.tra"/".tbaf"
            // share a basename) resolves it instead, same as it would for a real project. The URI
            // is built via pathToFileURL (not raw string interpolation) because the `#` in the
            // filename must be percent-encoded or it truncates the path at the URI fragment.
            const uri = pathToFileURL(join(dir, "x#lp1r.tbaf")).toString();
            const text = `const x = tra(0);`;
            const hover = t.getHover(uri, "typescript", "tra(0)", text);

            expect(hover).not.toBeNull();
            const value = (hover!.contents as { value: string }).value;
            expect(value).toContain("¿De verdad sabéis lo que dicen de vos?");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("round-trips byte-identically on save: untouched entries keep their exact windows-1252 bytes", async () => {
        const dir = mkdtempSync(join(tmpdir(), "mls-encoding-it-"));
        try {
            const traPath = join(dir, "x#lp1r.tra");
            copyFileSync(CP1252_FIXTURE, traPath);
            writeFileSync(join(dir, "x#lp1r.tbaf"), "");
            const originalBytes = readFileSync(traPath);

            const settings: ProjectTraSettings = { directory: dir, auto_tra: true };
            const t = new Translation(settings, dir);
            await t.init();

            // See the `#`-escaping note above - same reason a raw string URI here would silently
            // resolve to the wrong file.
            const uri = pathToFileURL(join(dir, "x#lp1r.tbaf")).toString();
            const text = `const x = tra(0);`;
            const result = t.writeMessages(uri, text, "typescript", { "0": "Edited only entry 0" });
            expect(result.changed).toBe(true);

            const updatedBytes = readFileSync(traPath);
            // File is still not valid UTF-8: it round-tripped as windows-1252, not transcoded.
            expect(() => new TextDecoder("utf-8", { fatal: true }).decode(updatedBytes)).toThrow();

            // Entry @1's line (untouched) carries the original accented bytes unchanged. Pure
            // byte-level search (an ASCII anchor + the next newline byte) - no re-decoding, so the
            // comparison can't be fooled by an encoding bug that happens to round-trip through text.
            const findLine = (buf: Buffer, marker: string): Buffer => {
                // "latin1" maps each JS char code 0x00-0xFF to exactly one byte, so the \xA1 (¡)
                // escape below lands as the literal raw cp1252 byte, not a re-encoded UTF-8 pair.
                const start = buf.indexOf(marker, 0, "latin1");
                expect(start).toBeGreaterThanOrEqual(0);
                const end = buf.indexOf(0x0a, start);
                return buf.subarray(start, end === -1 ? buf.length : end);
            };
            expect(findLine(updatedBytes, "@1  = ~¡Una oferta")).toEqual(findLine(originalBytes, "@1  = ~¡Una oferta"));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
