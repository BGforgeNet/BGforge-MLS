import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { dlgParser, readDlg } from "../src/dlg";

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

describe.skipIf(files.length === 0)("readDlg - real install corpus", () => {
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
        // The case that matters is the one the WeiDU fixtures cannot show: 17 files in this corpus have
        // text refs that SHARE an offset, and 4 carry bytes after the text block. A writer that recomputed
        // the layout from the resolved strings would change all 21 while still passing the fixture suite.
        const mismatched: string[] = [];

        for (const file of files) {
            const original = new Uint8Array(fs.readFileSync(file));
            const round = dlgParser.serialize!(dlgParser.parse(original));
            if (round.byteLength !== original.byteLength || !round.every((b, i) => b === original[i])) {
                mismatched.push(path.basename(file));
            }
        }

        expect(mismatched).toEqual([]);
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
