/**
 * Every drawable file in the real mod corpora, through the real thumbnail path.
 *
 * The unit tests build their inputs with the library's own writers, which means they only ever exercise the
 * shapes that writer emits. This is the pass that sees what modders actually ship: BAMC, v2 with sibling
 * pages, FRMs with no palette, and whatever else two decades of tooling has produced.
 */
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { pvrzResourceName } from "@bgforge/image";
import { TILE_SIZES } from "../src/ie-resources/tile-sizes";
import { canThumbnail, requiredPvrzPages, thumbnailDataUri } from "../src/ie-resources/thumbnails";
import { REPO_ROOT } from "./repo-root";

const CORPORA = [path.join(REPO_ROOT, "external/infinity-engine"), path.join(REPO_ROOT, "external/fallout")];

/** The cap `thumbnailDataUri` applies to source bytes; a file over it is declined by design, not by failure. */
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

function walk(dir: string, into: string[]): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, into);
        else if (canThumbnail(path.extname(entry.name).replace(".", ""))) into.push(full);
    }
}

const files: string[] = [];
for (const corpus of CORPORA) if (fs.existsSync(corpus)) walk(corpus, files);
files.sort();

/** Pages sit beside the `.bam` that names them, matched case-insensitively as the real resolver does. */
function siblingPvrz(bamPath: string): (page: number) => Uint8Array | undefined {
    const dir = path.dirname(bamPath);
    return (page) => {
        const wanted = pvrzResourceName(page).toLowerCase();
        try {
            const hit = fs.readdirSync(dir).find((entry) => entry.toLowerCase() === wanted);
            return hit === undefined ? undefined : new Uint8Array(fs.readFileSync(path.join(dir, hit)));
        } catch {
            return undefined;
        }
    };
}

describe.skipIf(files.length === 0)("thumbnails over the real corpora", () => {
    it("draws every drawable file, or declines it for a reason worth naming", () => {
        const size = 64;
        const reasons = new Map<string, number>();
        const note = (reason: string): void => {
            reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
        };
        let drawn = 0;
        let oversize = 0;

        for (const file of files) {
            const bytes = new Uint8Array(fs.readFileSync(file));
            if (bytes.length > MAX_SOURCE_BYTES) {
                oversize++;
                note("over the source cap");
                continue;
            }
            const ext = path.extname(file).replace(".", "");
            const needsPages = requiredPvrzPages(bytes).length > 0;
            const uri = thumbnailDataUri(bytes, ext, size, needsPages ? siblingPvrz(file) : undefined);
            if (uri === undefined) {
                note(needsPages ? "v2 whose pages are not beside it" : `undecodable ${ext.toLowerCase()}`);
                continue;
            }
            expect(uri.startsWith("data:image/"), file).toBe(true);
            drawn++;
        }

        // The population and every exclusion, printed rather than implied: a green run that quietly drew
        // three files would otherwise look identical to one that drew them all.
        const skipped = [...reasons].map(([reason, count]) => `${count} ${reason}`).join(", ");
        console.log(`gallery corpus: ${drawn}/${files.length} drawn${skipped ? ` (${skipped})` : ""}`);

        // A rate, not a count: the corpus is reproducible but not pinned, so an absolute floor would go
        // red the first time someone syncs a different set of mods.
        expect(drawn / files.length).toBeGreaterThan(0.9);
        expect(oversize, "a file over the 8 MB cap - check whether the cap is still right").toBe(0);
    }, 180_000);

    /**
     * E1: what is emitted never exceeds what was asked for. The whole memory argument for the gallery rests
     * on this - a grid holds hundreds of these at once, and one file that ignored the bound would not show up
     * as a wrong picture, only as a larger process.
     */
    it("never emits a picture larger than the requested size", () => {
        let checked = 0;
        for (const file of files.slice(0, 400)) {
            const bytes = new Uint8Array(fs.readFileSync(file));
            if (bytes.length > MAX_SOURCE_BYTES || requiredPvrzPages(bytes).length > 0) continue;
            const ext = path.extname(file).replace(".", "");
            for (const size of TILE_SIZES) {
                const uri = thumbnailDataUri(bytes, ext, size);
                if (uri === undefined) continue;
                // BMP passes through undecoded, so it is exempt by construction - there is no BMP decoder
                // here to downscale with, which is the documented trade in `thumbnailDataUri`.
                if (ext.toLowerCase() === "bmp") continue;
                const png = Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64");
                const width = png.readUInt32BE(16);
                const height = png.readUInt32BE(20);
                expect(Math.max(width, height), `${file} at ${size}`).toBeLessThanOrEqual(size);
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(0); // the sweep must actually have measured something
    }, 180_000);
});
