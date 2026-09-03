/**
 * Where thumbnail time actually goes, per stage and per variant.
 *
 * On demand, not in CI: these are wall-clock numbers, so they are machine-specific and belong in a commit
 * message as a ratio rather than in a threshold a shared runner would flake on. What CI checks instead are
 * the counting invariants in `client/test/gallery-panel-core.test.ts` and `gallery-corpus.test.ts`.
 *
 * Run: `pnpm bench:thumbnails [-- --samples N]`. The client tsconfig is required, not incidental: it carries
 * the `paths` entry that resolves `@bgforge/image` to source, and without it tsx resolves the package name to
 * a build output that may not exist.
 */
import * as fs from "fs";
import * as path from "path";
import { decodeBamc, decodeBamV1Frames, isBamc, parseBamV1, readBamV1Tables } from "../image/src/index.ts";
import { thumbnailDataUri } from "../client/src/ie-resources/thumbnails.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SAMPLES = Number(process.argv[process.argv.indexOf("--samples") + 1]) || 20;

function walk(dir: string, ext: string, into: string[], limit: number): void {
    if (into.length >= limit) return;
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (into.length >= limit) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, ext, into, limit);
        else if (entry.name.toLowerCase().endsWith(ext)) into.push(full);
    }
}

/** Median, not mean: one GC pause in a sample set should not become the number that gets quoted. */
function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
}

function time(runs: number, fn: () => void): number {
    const samples: number[] = [];
    for (let i = 0; i < runs; i++) {
        const started = performance.now();
        fn();
        samples.push(performance.now() - started);
    }
    return median(samples);
}

const bams: string[] = [];
walk(path.join(REPO_ROOT, "external/infinity-engine"), ".bam", bams, 400);
if (bams.length === 0) {
    console.error("No BAMs found under external/ - run `pnpm test:external` to populate the corpora.");
    process.exit(1);
}

// The two shapes that behave differently: BAMC pays a whole-file inflate before any table is readable, so
// selective decode buys nothing there, while a plain v1 skips every frame it is not asked for.
const plain = bams.filter((f) => !isBamc(new Uint8Array(fs.readFileSync(f))));
const compressed = bams.filter((f) => isBamc(new Uint8Array(fs.readFileSync(f))));

console.log(`corpus: ${bams.length} BAMs (${plain.length} plain v1, ${compressed.length} BAMC)`);
console.log(`samples per measurement: ${SAMPLES}\n`);

for (const [label, set] of [
    ["plain v1", plain],
    ["BAMC", compressed],
] as const) {
    if (set.length === 0) continue;
    // The file with the most frames in each set - where full-vs-selective parse differs most, and the case
    // the selective path was added for.
    const richest = set
        .map((file) => {
            const bytes = new Uint8Array(fs.readFileSync(file));
            try {
                return { file, bytes, frames: readBamV1Tables(bytes).frameCount };
            } catch {
                return { file, bytes, frames: 0 };
            }
        })
        .sort((a, b) => b.frames - a.frames)[0]!;

    console.log(`${label}: ${path.basename(richest.file)} (${richest.frames} frames)`);
    // `parseBamV1` reads uncompressed v1 only, so a BAMC is inflated first - which is itself the reason the
    // selective path saves nothing on a BAMC: the whole payload is already in memory before any table reads.
    const raw = isBamc(richest.bytes) ? decodeBamc(richest.bytes) : richest.bytes;
    const full = time(SAMPLES, () => void parseBamV1(raw));
    const tables = time(SAMPLES, () => void readBamV1Tables(richest.bytes));
    const oneFrame = time(SAMPLES, () => void decodeBamV1Frames(richest.bytes, [0]));
    const fourFrames = time(SAMPLES, () => void decodeBamV1Frames(richest.bytes, [0, 1, 2, 3]));
    const tile = time(SAMPLES, () => void thumbnailDataUri(richest.bytes, "bam", 64));

    // Ratios against the full parse: an absolute millisecond figure is machine-specific and must not travel.
    const ratio = (value: number): string => `${((value / full) * 100).toFixed(1)}% of full parse`;
    console.log(`  tables only     ${ratio(tables)}`);
    console.log(`  1 frame         ${ratio(oneFrame)}`);
    console.log(`  4 frames        ${ratio(fourFrames)}`);
    console.log(`  whole tile      ${ratio(tile)}  (decode + downscale + PNG encode)\n`);
}

// What the grid actually does on a cold scroll: one tile per file, over as many as a viewport holds.
const viewport = bams.slice(0, 40).map((file) => new Uint8Array(fs.readFileSync(file)));
const scroll = time(5, () => {
    for (const bytes of viewport) void thumbnailDataUri(bytes, "bam", 64);
});
console.log(`cold scroll of ${viewport.length} tiles: ${(scroll / viewport.length).toFixed(2)} ms per tile`);
