import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { readDlg } from "../src/dlg";
import { REPO_ROOT } from "./repo-root";

/**
 * Differential against the reference implementation.
 *
 * `dlg-corpus.test.ts` sweeps a real install but can only run where one exists; this suite is reproducible
 * anywhere, because WeiDU compiles the committed `.d` fixtures itself. It is not redundant with that sweep -
 * the two exercise different producers (the shipped game's writer vs WeiDU's), and this one has a real
 * oracle: WeiDU reports its own table counts per file, so the reader is checked against the reference's
 * accounting rather than against itself.
 *
 * `--nogame` means no IDS tables, so WeiDU warns that it cannot verify trigger/action names and writes them
 * through verbatim. That is the behaviour under test, not a defect - the DLG stores the text either way.
 */
const FIXTURE_DIR = path.join(REPO_ROOT, "binary/test/fixtures/dlg");
const WEIDU_TIMEOUT_MS = 60_000;
/** `scripts/ensure-weidu.sh` exports WEIDU_BIN - the host's own WeiDU, or the pinned one it downloads. */
const WEIDU = process.env.WEIDU_BIN ?? "weidu";

/** WeiDU prints e.g. `[MINIMAL.DLG] saved  2 states, 3 trans, 1 strig, 1 ttrig, 1 actions`. */
const SAVED_LINE = /\[(\w+)\.DLG\]\s+saved\s+(\d+) states, (\d+) trans, (\d+) strig, (\d+) ttrig, (\d+) actions/g;

interface Counts {
    states: number;
    transitions: number;
    stateTriggers: number;
    transitionTriggers: number;
    actions: number;
}

function weiduAvailable(): boolean {
    try {
        execFileSync(WEIDU, ["--version"], { timeout: WEIDU_TIMEOUT_MS, stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

const available = weiduAvailable();

let workDir = "";
let reported: Map<string, Counts>;

describe.skipIf(!available)("readDlg - differential against WeiDU-compiled DLGs", () => {
    beforeAll(() => {
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-dlg-"));
        const sources = fs
            .readdirSync(FIXTURE_DIR)
            .filter((f) => f.endsWith(".d"))
            .sort();
        for (const src of sources) fs.copyFileSync(path.join(FIXTURE_DIR, src), path.join(workDir, src));

        // One invocation for all fixtures: extern.d's EXTERN label only resolves when its target dialog is
        // compiled in the same run. WeiDU writes its own placeholder DIALOG.TLK into the output dir too.
        const stdout = execFileSync(WEIDU, ["--nogame", "--out", ".", ...sources], {
            cwd: workDir,
            timeout: WEIDU_TIMEOUT_MS,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        });

        reported = new Map();
        for (const m of stdout.matchAll(SAVED_LINE)) {
            reported.set(m[1]!, {
                states: Number(m[2]),
                transitions: Number(m[3]),
                stateTriggers: Number(m[4]),
                transitionTriggers: Number(m[5]),
                actions: Number(m[6]),
            });
        }
    });

    afterAll(() => {
        if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
    });

    function read(name: string) {
        return readDlg(new Uint8Array(fs.readFileSync(path.join(workDir, `${name}.dlg`))));
    }

    test("compiles every fixture and reports counts for each", () => {
        // Guards the oracle itself: if WeiDU's output format changes, the regex silently matches nothing and
        // every count assertion below would compare undefined to undefined.
        expect([...reported.keys()].sort()).toEqual(["EXTERND", "JOURNALD", "MINIMAL"]);
    });

    test.each(["MINIMAL", "EXTERND", "JOURNALD"])("%s table counts match WeiDU's own accounting", (name) => {
        const dlg = read(name);
        const expected = reported.get(name)!;

        expect({
            states: dlg.states.length,
            transitions: dlg.transitions.length,
            stateTriggers: dlg.stateTriggers.length,
            transitionTriggers: dlg.transitionTriggers.length,
            actions: dlg.actions.length,
        }).toEqual(expected);
    });

    test("a GOTO carries a trigger and an action but no reply text", () => {
        const first = read("MINIMAL").transitions[0]!;

        expect(first.hasTrigger).toBe(true);
        expect(first.hasAction).toBe(true);
        expect(first.hasText).toBe(false);
        expect(first.terminatesDialog).toBe(false);
    });

    test("an EXTERN transition names the target dialog and state", () => {
        const transition = read("EXTERND").transitions[0]!;

        expect(transition.terminatesDialog).toBe(false);
        // Resrefs are 8 bytes NUL-padded; the reader keeps them verbatim so the bytes round-trip.
        expect(transition.nextDialog.split("\u0000")[0]).toBe("MINIMAL");
        expect(transition.nextState).toBe(1);
    });

    test("a JOURNAL entry sets the journal bit alongside the terminate bit", () => {
        const transition = read("JOURNALD").transitions[0]!;

        expect(transition.hasJournalEntry).toBe(true);
        expect(transition.terminatesDialog).toBe(true);
    });

    test("trigger and action text survives the round trip through WeiDU verbatim", () => {
        const dlg = read("MINIMAL");

        expect(dlg.stateTriggers).toContain("NumTimesTalkedTo(0)");
        expect(dlg.transitionTriggers).toContain('Global("x","GLOBAL",1)');
        expect(dlg.actions).toContain('SetGlobal("x","GLOBAL",2)');
    });
});
