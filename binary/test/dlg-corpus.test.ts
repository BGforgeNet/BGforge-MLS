import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { buildDlg, dlgParser, readDlg, toDlgBuildInput } from "../src/dlg";

/**
 * Structural sweep over a real game install's DLG resources.
 *
 * Every DLG ships inside a BIF archive, so unlike the `external/` mod trees there is no reproducible corpus
 * to check out - the suite is gated on an install the runner points it at. `dlg-read.test.ts` covers the
 * reader's behaviour hermetically; this sweep is what catches a spec misreading that a hand-built fixture
 * would share, since the fixture and the reader come from the same reading of IESDP.
 *
 *   BGFORGE_DLG_CORPUS=/path/to/game pnpm exec vitest run --config binary/vitest.config.ts dlg-corpus
 */
const CORPUS_ROOT = process.env.BGFORGE_DLG_CORPUS;

function findDlgFiles(root: string): string[] {
    const out: string[] = [];
    function walk(dir: string): void {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile() && entry.name.toLowerCase().endsWith(".dlg")) out.push(full);
        }
    }
    if (fs.existsSync(root)) walk(root);
    return out.sort();
}

const files = CORPUS_ROOT ? findDlgFiles(CORPUS_ROOT) : [];

const STATE_SIZE = 16;
const TRANSITION_SIZE = 32;
const PAIR_SIZE = 8;

/**
 * Whether the file itself uses the layout `buildDlg` writes: tables in wire order right after the header,
 * then every string appended in table order, ending at EOF.
 */
function isCanonicalLayout(bytes: Uint8Array): boolean {
    const result = dlgParser.parse(bytes);
    const doc = result.document as
        | {
              header: Record<string, number>;
              headerInterrupt?: unknown;
              states: unknown[];
              transitions: unknown[];
              stateTriggerRefs: { offset: number; length: number }[];
              transitionTriggerRefs: { offset: number; length: number }[];
              actionRefs: { offset: number; length: number }[];
          }
        | undefined;
    if (!doc) return false;

    const headerSize = doc.headerInterrupt ? 0x34 : 0x30;
    const refs = [...doc.stateTriggerRefs, ...doc.transitionTriggerRefs, ...doc.actionRefs];
    let at = headerSize;
    for (const [offset, count, size] of [
        [doc.header.stateTableOffset, doc.states.length, STATE_SIZE],
        [doc.header.transitionTableOffset, doc.transitions.length, TRANSITION_SIZE],
        [doc.header.stateTriggerTableOffset, doc.stateTriggerRefs.length, PAIR_SIZE],
        [doc.header.transitionTriggerTableOffset, doc.transitionTriggerRefs.length, PAIR_SIZE],
        [doc.header.actionTableOffset, doc.actionRefs.length, PAIR_SIZE],
    ] as [number, number, number][]) {
        if (offset !== at) return false;
        at += count * size;
    }
    for (const ref of refs) {
        if (ref.offset !== at) return false;
        at += ref.length;
    }
    return at === bytes.byteLength;
}

describe.skipIf(files.length === 0)(`readDlg - real install corpus (${files.length} dialogs)`, () => {
    test("every DLG parses with a V1 header and in-bounds table indices", () => {
        const failures: string[] = [];
        let states = 0;
        let transitions = 0;

        for (const file of files) {
            const name = path.basename(file);
            const dlg = readDlg(new Uint8Array(fs.readFileSync(file)));
            if (dlg.signature !== "DLG " || dlg.version !== "V1.0") {
                failures.push(`${name}: signature ${JSON.stringify(dlg.signature + dlg.version)}`);
                continue;
            }
            states += dlg.states.length;
            transitions += dlg.transitions.length;

            for (const state of dlg.states) {
                // A state owns the consecutive transition range [first, first+count).
                if (state.firstTransition + state.transitionCount > dlg.transitions.length) {
                    failures.push(`${name}: state transition range overruns the transition table`);
                }
                if (state.triggerIndex >= dlg.stateTriggers.length) {
                    failures.push(`${name}: state triggerIndex ${state.triggerIndex} out of bounds`);
                }
            }
            for (const transition of dlg.transitions) {
                if (transition.hasTrigger && transition.triggerIndex >= dlg.transitionTriggers.length) {
                    failures.push(`${name}: transition triggerIndex out of bounds`);
                }
                if (transition.hasAction && transition.actionIndex >= dlg.actions.length) {
                    failures.push(`${name}: transition actionIndex out of bounds`);
                }
            }
        }

        expect(failures).toEqual([]);
        // Floor on the population so a collapsed corpus cannot pass vacuously.
        expect(files.length).toBeGreaterThan(100);
        expect(states).toBeGreaterThan(transitions / 4);
    });

    test("every DLG round-trips byte-identically", () => {
        // The case that matters is the one the WeiDU fixtures cannot show: 547 files of a stock BG:EE plus
        // BG2:ToB pair have text refs that SHARE an offset, and 80 order the text block by dialog structure
        // rather than by table. `buildDlg` reproduces neither, by design - preserving the source bytes is
        // what makes an unedited file come back exactly.
        const mismatched: string[] = [];

        for (const file of files) {
            const original = new Uint8Array(fs.readFileSync(file));
            const round = dlgParser.serialize(dlgParser.parse(original));
            if (round.byteLength !== original.byteLength || !round.every((b, i) => b === original[i])) {
                mismatched.push(path.basename(file));
            }
        }

        expect(mismatched).toEqual([]);
    });

    test("rebuilding every DLG from its own content preserves that content", () => {
        // `buildDlg`'s gate cannot be byte-identity - it decides a layout rather than preserving one - so
        // what it owes is that nothing is lost or reordered on the way through.
        const mismatched: string[] = [];

        for (const file of files) {
            const original = new Uint8Array(fs.readFileSync(file));
            const rebuilt = readDlg(buildDlg(toDlgBuildInput(original)));
            const before = readDlg(original);
            if (JSON.stringify(rebuilt) !== JSON.stringify(before)) mismatched.push(path.basename(file));
        }

        expect(mismatched).toEqual([]);
    });

    test("a rebuild that is not byte-identical is one the source file laid out differently", () => {
        // The builder writes the reference implementation's layout. Where a real file disagrees, the
        // difference has to be the FILE's - so every non-identical rebuild is checked against the source's
        // own ref offsets, and a file whose layout IS canonical must come back byte for byte.
        const unexplained: string[] = [];
        let identical = 0;

        for (const file of files) {
            const original = new Uint8Array(fs.readFileSync(file));
            const rebuilt = buildDlg(toDlgBuildInput(original));
            if (rebuilt.byteLength === original.byteLength && rebuilt.every((b, i) => b === original[i])) {
                identical++;
                continue;
            }
            if (isCanonicalLayout(original)) unexplained.push(path.basename(file));
        }

        expect(unexplained).toEqual([]);
        // A floor on the population, so a corpus that stopped matching cannot pass by explaining everything.
        expect(identical).toBeGreaterThan(files.length / 2);
    });

    test("every trigger and action string is printable ASCII", () => {
        // What makes a read-only view possible: the trigger and action text comes out verbatim, needing no compiler.
        const offenders: string[] = [];

        for (const file of files) {
            const dlg = readDlg(new Uint8Array(fs.readFileSync(file)));
            for (const fragment of [...dlg.stateTriggers, ...dlg.transitionTriggers, ...dlg.actions]) {
                if (!/^[\t\n\r -~]*$/.test(fragment)) {
                    offenders.push(`${path.basename(file)}: ${JSON.stringify(fragment.slice(0, 40))}`);
                }
            }
        }

        expect(offenders).toEqual([]);
    });
});
