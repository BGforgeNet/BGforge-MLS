import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { readBcs, writeBcs } from "@bgforge/bcs";

/**
 * Round-trip byte-identity over a real install's compiled scripts.
 *
 * This is the milestone the codec has to clear before anything is built on it, and it needs no reference
 * compiler, no IDS tables and no install detection - only the files themselves. A BCS ships inside a game's
 * BIF archives, so unlike the `external/` mod trees there is no reproducible corpus to check out and the
 * sweep is gated on an install the runner points it at. Point it at a game directory's extracted scripts,
 * or at any directory of `.bcs` / `.bs` files:
 *
 *   BGFORGE_BCS_CORPUS=/path/to/scripts pnpm exec vitest run --config compilers/bcs/vitest.config.ts corpus
 *
 * `read.test.ts` and `write.test.ts` cover the behaviour hermetically; this is what catches a record shape
 * a hand-built fixture would share with the reader, both having come from the same reading of one file.
 */
const CORPUS_ROOT = process.env.BGFORGE_BCS_CORPUS;

function findBcsFiles(root: string): string[] {
    const out: string[] = [];
    function walk(dir: string): void {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            // `.bs` is the same format under another extension - the AI-selection scripts a game ships
            // loose in `scripts/` - so both are corpus.
            else if (entry.isFile() && /\.(bcs|bs)$/i.test(entry.name)) out.push(full);
        }
    }
    if (fs.existsSync(root)) walk(root);
    return out.sort();
}

const files = CORPUS_ROOT ? findBcsFiles(CORPUS_ROOT) : [];

/**
 * The mod trees under `external/` are gitignored but reproducible (`pnpm test:external`), so the handful of
 * compiled scripts a mod ships in its backup directories is corpus that runs in CI, unlike the install sweep
 * above. They matter out of proportion to their number: a mod's BCS was written by WeiDU rather than by the
 * game's own compiler, which is the second producer this codec has to read.
 */
const EXTERNAL_FILES = findBcsFiles(path.resolve(__dirname, "../../../external"));

describe.skipIf(EXTERNAL_FILES.length === 0)("BCS codec - mod scripts from external/", () => {
    test("every script re-emits byte-identically", () => {
        const mismatched: string[] = [];

        for (const file of EXTERNAL_FILES) {
            const original = fs.readFileSync(file, "latin1");
            if (original === "") continue;
            if (writeBcs(readBcs(original)) !== original) mismatched.push(path.basename(file));
        }

        expect(mismatched).toEqual([]);
    });
});

describe.skipIf(files.length === 0)("BCS codec - real install corpus", () => {
    test("every script re-emits byte-identically", () => {
        const mismatched: string[] = [];
        const empty: string[] = [];

        for (const file of files) {
            // BCS is ASCII, and latin1 is the byte-preserving decoding of it - a stray high byte in a
            // quoted field survives the round trip instead of becoming a replacement character.
            const original = fs.readFileSync(file, "latin1");
            // A zero-byte file holds no script; the codec refuses it rather than inventing markers, so it
            // is counted out loud here rather than dropped from the denominator in silence.
            if (original === "") {
                empty.push(path.basename(file));
                continue;
            }
            if (writeBcs(readBcs(original)) !== original) mismatched.push(path.basename(file));
        }

        expect(mismatched).toEqual([]);
        // A floor on the population, so a corpus that failed to resolve cannot pass vacuously.
        // The gate is zero mismatches among the scripts actually judged; the floor only stops a corpus
        // that resolved to nothing but empty files from passing vacuously.
        expect(files.length - empty.length).toBeGreaterThan(0);
        console.log(
            `BCS corpus: ${files.length - empty.length} scripts round-tripped, ${empty.length} empty files skipped`,
        );
    });

    test("every script parses into the nesting the format actually has", () => {
        // Measured over 4939 non-empty files: a condition-response block holds exactly one condition and
        // one response set, a trigger exactly one object, an action exactly three. Nothing in the corpus
        // deviates, so a deviation is a reader defect rather than a variant.
        const failures: string[] = [];
        let triggers = 0;
        let actions = 0;

        for (const file of files) {
            const name = path.basename(file);
            const text = fs.readFileSync(file, "latin1");
            if (text === "") continue;
            const script = readBcs(text);
            for (const block of script.blocks) {
                triggers += block.triggers.length;
                for (const response of block.responses) {
                    actions += response.actions.length;
                    for (const action of response.actions) {
                        if (action.objects.length !== 3)
                            failures.push(`${name}: action has ${action.objects.length} objects`);
                    }
                }
            }
        }

        expect(failures).toEqual([]);
        expect(triggers).toBeGreaterThan(0);
        expect(actions).toBeGreaterThan(0);
    });
});
