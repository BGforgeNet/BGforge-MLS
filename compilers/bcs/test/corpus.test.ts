import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import type { Parser } from "web-tree-sitter";
import { BcsCompileError, compileBaf, decompileBcs, readBcs, writeBcs } from "@bgforge/bcs";
import { getParser, initParser } from "../../../shared/parsers/weidu-baf";
import { readIdsTables } from "./ids-tables";

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
 * The install's own IDS tables, which naming needs and the round trip above does not.
 *
 * A separate variable because the two sweeps answer different questions: the codec's round trip is gated on
 * the files alone, while compiling back needs the same tables the game resolves names against. Point it at
 * the directory holding TRIGGER.IDS, ACTION.IDS and friends - a game's `scripts/`, or wherever they were
 * extracted to:
 *
 *   BGFORGE_BCS_IDS=/path/to/ids BGFORGE_BCS_CORPUS=/path/to/scripts pnpm exec vitest run \
 *     --config compilers/bcs/vitest.config.ts corpus
 */
const IDS_ROOT = process.env.BGFORGE_BCS_IDS;

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

    test("no record carries more fields than its argument list has slots", () => {
        // IESDP fixes the argument lists: a trigger takes five numbers and two strings, an action five and
        // two, and an object twelve numbers before Torment's two extras - fourteen, the most any engine
        // stores ahead of a name, since Icewind Dale II keeps its own last two behind one. Truncation by an
        // older writer can only take fields away, so anything OVER the ceiling means the reader split a line
        // wrongly - which is exactly what counting numbers across a whole line does to an object named
        // `"HOUSEN2"`.
        const over: string[] = [];

        for (const file of files) {
            const name = path.basename(file);
            const text = fs.readFileSync(file, "latin1");
            if (text === "") continue;
            const note = (what: string, ints: number, strings: number, maxInts: number, maxStrings: number): void => {
                if (ints > maxInts || strings > maxStrings) over.push(`${name}: ${what} has ${ints}i ${strings}s`);
            };
            for (const block of readBcs(text).blocks) {
                for (const trigger of block.triggers) {
                    note("trigger", trigger.ints.length, trigger.strings.length, 5, 2);
                    note("object", trigger.object.ints.length, 0, 14, 0);
                }
                for (const response of block.responses) {
                    for (const action of response.actions) {
                        note("action", action.ints.length, action.strings.length, 5, 2);
                        for (const object of action.objects) note("object", object.ints.length, 0, 14, 0);
                    }
                }
            }
        }

        expect(over).toEqual([]);
    });
});

describe.skipIf(files.length === 0 || IDS_ROOT === undefined)("BCS compiler - real install corpus", () => {
    const tables = readIdsTables(IDS_ROOT ?? "");
    let parser: Parser;

    beforeAll(async () => {
        await initParser();
        parser = getParser();
    });

    const roundTrip = (text: string): string =>
        writeBcs(compileBaf(parser, decompileBcs(readBcs(text), tables.symbols), tables.compileSymbols));

    /**
     * The save path a compiled script's editable view takes, over a whole install.
     *
     * Byte-identity is NOT the gate, and cannot be: two things a stored record can hold have no spelling in
     * BAF - a record the BG1-era writer stopped short of finishing, and a number sitting in a slot no
     * signature names - so a script carrying either compiles back to the full, clean form instead. The
     * reference implementation loses exactly the same bytes on the same round trip, which is what says this
     * is the source form's limit rather than the compiler's.
     *
     * What IS gated is that the loss happens ONCE. A view that degraded a script a little further on every
     * save would be unusable, and idempotence is the property that rules it out - measured against the whole
     * install rather than the three fixtures a checkout can compile.
     */
    test("every script compiles back, and saving it again changes nothing", () => {
        const drifted: string[] = [];
        // Refusals are tallied by reason rather than swallowed: a sweep that quietly stopped judging most of
        // the corpus would otherwise report the same green as one that judged all of it.
        const refused = new Map<string, number>();
        let judged = 0;
        let identical = 0;

        for (const file of files) {
            const original = fs.readFileSync(file, "latin1");
            if (original === "") continue;
            let once: string;
            try {
                once = roundTrip(original);
            } catch (error) {
                const reason =
                    error instanceof BcsCompileError ? (error.diagnostics[0]?.message ?? error.message) : String(error);
                refused.set(reason, (refused.get(reason) ?? 0) + 1);
                continue;
            }
            judged++;
            if (once === original) identical++;
            else if (roundTrip(once) !== once) drifted.push(path.basename(file));
        }

        const skipped = [...refused.values()].reduce((total, count) => total + count, 0);
        console.log(
            `BCS compiler: ${judged} scripts compiled back (${identical} byte-identical, ` +
                `${judged - identical} through a form BAF cannot spell), ${skipped} refused`,
        );
        for (const [reason, count] of refused) console.log(`  refused ${count}: ${reason}`);
        expect(drifted).toEqual([]);
        expect(refused.size).toBe(0);
        // A floor on the population, so a corpus that resolved to nothing cannot pass vacuously.
        expect(judged).toBeGreaterThan(0);
    });
});
