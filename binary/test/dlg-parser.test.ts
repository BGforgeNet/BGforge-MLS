import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildDlg, dlgParser, readDlg } from "../src/dlg";
import type { DlgCanonicalDocument } from "../src/dlg/canonical-schemas";
import { createCanonicalDlgJsonSnapshot, loadCanonicalDlgJsonSnapshot } from "../src/dlg/json-snapshot";
import { REPO_ROOT } from "./repo-root";

/**
 * `BinaryParser` conformance and the byte round-trip.
 *
 * Round-trip byte-identity is the milestone that has to hold before anything is built on the codec: it needs
 * no install and no reference oracle, and it is what a future writer (a TypeScript API emitting DLG in place
 * of WeiDU's D) rests on. Fixtures are compiled by the pinned WeiDU, same as `dlg-weidu-differential`.
 */
const FIXTURE_DIR = path.join(REPO_ROOT, "binary/test/fixtures/dlg");
const WEIDU_TIMEOUT_MS = 60_000;
/** `scripts/ensure-weidu.sh` exports WEIDU_BIN - the host's own WeiDU, or the pinned one it downloads. */
const WEIDU = process.env.WEIDU_BIN ?? "weidu";
const COMPILED = ["MINIMAL", "EXTERND", "JOURNALD"] as const;

const BG1_HEADER_SIZE = 0x30;

/**
 * An empty BG1-era dialog: a 48-byte header, five table offsets pointing at its end, five zero counts.
 * WeiDU emits the post-BG1 header, so these files cannot be produced by the fixture compile - and a stock
 * BG:EE plus BG2:ToB pair ships 1002 files with this header, fifteen of them this bare.
 */
function buildEmptyBg1Dlg(): Uint8Array {
    const bytes = new Uint8Array(BG1_HEADER_SIZE);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < 4; i++) bytes[i] = "DLG ".codePointAt(i)!;
    for (let i = 0; i < 4; i++) bytes[4 + i] = "V1.0".codePointAt(i)!;
    for (const at of [0x0c, 0x14, 0x18, 0x20, 0x28]) view.setUint32(at, BG1_HEADER_SIZE, true);
    return bytes;
}

describe("dlgParser - BG1-era 48-byte header", () => {
    test("parses an empty BG1-era dialog instead of rejecting it as truncated", () => {
        const result = dlgParser.parse(buildEmptyBg1Dlg());

        expect(result.errors ?? []).toEqual([]);
        expect(result.document).toBeDefined();
    });

    test("does not decode an interrupt-flags field the file does not carry", () => {
        const result = dlgParser.parse(buildEmptyBg1Dlg());

        expect((result.document as DlgCanonicalDocument).headerInterrupt).toBeUndefined();
    });

    test("round-trips byte-identically, without growing the header", () => {
        const original = buildEmptyBg1Dlg();

        const round = dlgParser.serialize!(dlgParser.parse(original));

        expect(round.byteLength).toBe(BG1_HEADER_SIZE);
        expect([...round]).toEqual([...original]);
    });
});

describe("serializeDlg - a document that does not fit its bytes", () => {
    // Both writers land here, and the JSON-snapshot path is the one that can arrive with a document
    // someone edited by hand (`fgbin --load`). Writing a header whose counts or refs address bytes the
    // file does not have produces a DLG that overruns in every reader, so it has to be refused rather
    // than emitted.
    function snapshotOf(bytes: Uint8Array): Record<string, never> {
        return JSON.parse(createCanonicalDlgJsonSnapshot(dlgParser.parse(bytes)));
    }

    const source = (): Uint8Array =>
        buildDlg({
            states: [{ text: 1, firstTransition: 0, transitionCount: 0, triggerIndex: 0 }],
            transitions: [],
            stateTriggers: ['Dead("x")'],
            transitionTriggers: [],
            actions: ["Wait(1)"],
        });

    test.each([
        ["a text ref reaching past the end", (d: Record<string, any>) => (d.actionRefs[0].length += 5000)],
        ["a text ref starting past the end", (d: Record<string, any>) => (d.actionRefs[0].offset += 5000)],
        ["a record count larger than its table", (d: Record<string, any>) => (d.header.stateCount += 500)],
        ["a table offset past the end", (d: Record<string, any>) => (d.header.stateTableOffset += 5000)],
    ])("refuses %s", (_name, corrupt) => {
        const snapshot = snapshotOf(source()) as Record<string, any>;
        corrupt(snapshot.document);

        expect(() => loadCanonicalDlgJsonSnapshot(JSON.stringify(snapshot))).toThrow(/does not fit|out of range/i);
    });

    test("accepts the document it was given untouched", () => {
        // The negative control: the same path with nothing corrupted has to stay silent, or the guard is
        // refusing correct input.
        const original = source();
        const snapshot = snapshotOf(original);

        const { bytes } = loadCanonicalDlgJsonSnapshot(JSON.stringify(snapshot));

        expect([...bytes!]).toEqual([...original]);
    });
});

describe("dlgParser.parse - a header addressing bytes the file does not have", () => {
    // The READ side of the same condition the writer refuses above. Before these, an overrunning count threw
    // a bare `RangeError: Offset is outside the bounds of the DataView` out of the record reader - naming
    // neither the file nor the section, and bypassing `ParseResult.errors` entirely, which is where every
    // other malformed-DLG refusal is reported.
    const source = (): Uint8Array =>
        buildDlg({
            states: [{ text: 1, firstTransition: 0, transitionCount: 0, triggerIndex: 0 }],
            transitions: [],
            stateTriggers: ['Dead("x")'],
            transitionTriggers: [],
            actions: [],
        });

    /** Overwrite one little-endian dword of a built file. */
    function corrupt(bytes: Uint8Array, at: number, value: number): Uint8Array {
        const copy = new Uint8Array(bytes);
        new DataView(copy.buffer).setUint32(at, value, true);
        return copy;
    }

    const STATE_COUNT_AT = 0x08;
    const STATE_TABLE_OFFSET_AT = 0x0c;
    const STATE_TRIGGER_TABLE_OFFSET_AT = 0x18;
    const STATE_SIZE = 16;

    /** The largest state count whose table still ends inside the file - the last value that must be accepted. */
    function widestFittingStateCount(bytes: Uint8Array): number {
        const at = new DataView(bytes.buffer).getUint32(STATE_TABLE_OFFSET_AT, true);
        return Math.floor((bytes.byteLength - at) / STATE_SIZE);
    }

    test.each([
        ["far past the end", () => 0xffff_ffff],
        // The boundary itself: one record more than the file can hold. A check written as `>=` rather than
        // `>` would refuse the fitting count below instead, and only this pair separates the two.
        ["one record past the end", (bytes: Uint8Array) => widestFittingStateCount(bytes) + 1],
    ])("reports a state count %s through errors rather than throwing", (_name, count) => {
        const bytes = source();

        const result = dlgParser.parse(corrupt(bytes, STATE_COUNT_AT, count(bytes)));

        expect(result.errors?.[0]).toMatch(/^Truncated DLG: state table does not fit - /);
        expect(result.document).toBeUndefined();
    });

    test("accepts the widest state count that still fits", () => {
        const bytes = source();

        const result = dlgParser.parse(corrupt(bytes, STATE_COUNT_AT, widestFittingStateCount(bytes)));

        expect(result.errors ?? []).toEqual([]);
    });

    test("reports a text ref reaching past the end", () => {
        const bytes = source();
        // The state-trigger table's first entry is `[offset, length]`; push its length past EOF so the ref
        // check - which can only run once the tables are decoded - is the one that fires.
        const table = new DataView(bytes.buffer).getUint32(STATE_TRIGGER_TABLE_OFFSET_AT, true);

        const result = dlgParser.parse(corrupt(bytes, table + 4, 5000));

        expect(result.errors?.[0]).toMatch(/^Truncated DLG: state trigger 0 does not fit - /);
    });

    // `readDlg` is the entry point the dialog editor, its writer and the reference scan all take, and it
    // used to reach the record reader with no bounds at all: the same file the parser named a section for
    // surfaced there as `RangeError: Invalid code point NaN`, which reached the user verbatim.
    test.each([
        ["an overrunning state count", (b: Uint8Array) => corrupt(b, STATE_COUNT_AT, 0xffff_ffff)],
        [
            "a text ref reaching past the end",
            (b: Uint8Array) =>
                corrupt(b, new DataView(b.buffer).getUint32(STATE_TRIGGER_TABLE_OFFSET_AT, true) + 4, 5000),
        ],
        ["a file shorter than the header", (b: Uint8Array) => b.slice(0, 8)],
    ])("readDlg refuses %s with the sentence the parser reports", (_name, corruptOne) => {
        const bytes = corruptOne(source());

        expect(() => readDlg(bytes)).toThrow(/^Truncated DLG: /);
        expect(dlgParser.parse(bytes).errors?.[0]).toMatch(/^Truncated DLG: /);
    });

    test("readDlg stays silent on a file that is correct", () => {
        // Negative control for the guard above: it must not refuse real input.
        expect(() => readDlg(source())).not.toThrow();
    });

    test("accepts the file it was given untouched", () => {
        // Negative control: the guard must stay silent on a file that is correct, or it is refusing real input.
        const result = dlgParser.parse(source());

        expect(result.errors ?? []).toEqual([]);
        expect(result.document).toBeDefined();
    });
});

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

describe.skipIf(!available)(
    `dlgParser (WeiDU ${available ? "present" : "absent"}, ${COMPILED.length} fixtures)`,
    () => {
        beforeAll(() => {
            workDir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-dlg-parser-"));
            const sources = fs
                .readdirSync(FIXTURE_DIR)
                .filter((f) => f.endsWith(".d"))
                .sort();
            for (const src of sources) fs.copyFileSync(path.join(FIXTURE_DIR, src), path.join(workDir, src));
            execFileSync(WEIDU, ["--nogame", "--out", ".", ...sources], {
                cwd: workDir,
                timeout: WEIDU_TIMEOUT_MS,
                stdio: "ignore",
            });
        });

        afterAll(() => {
            if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
        });

        const bytesOf = (name: string): Uint8Array =>
            new Uint8Array(fs.readFileSync(path.join(workDir, `${name}.dlg`)));

        test("declares the identity the registry and resource browser route on", () => {
            expect(dlgParser.id).toBe("dlg");
            expect(dlgParser.extensions).toEqual(["dlg"]);
            // `family` is load-bearing: the two game families collide on some extensions, and the IE resource
            // browser derives which formats open in an editor from it.
            expect(dlgParser.family).toBe("infinity-engine");
        });

        test("decodes the interrupt-flags field a post-BG1 header carries", () => {
            const result = dlgParser.parse(bytesOf("MINIMAL"));

            expect((result.document as DlgCanonicalDocument).headerInterrupt).toBeDefined();
        });

        test("parses to a display tree and a canonical document", () => {
            const result = dlgParser.parse(bytesOf("MINIMAL"));

            expect(result.errors ?? []).toEqual([]);
            expect(result.format).toBe("dlg");
            expect(result.root.fields.length).toBeGreaterThan(0);
            expect(result.document).toBeDefined();
        });

        test("rejects a file whose signature is not a DLG", () => {
            const notADlg = new Uint8Array(64);
            notADlg.set(
                [..."ITM "].map((c) => c.codePointAt(0)!),
                0,
            );

            const result = dlgParser.parse(notADlg);

            expect(result.errors?.join(" ")).toMatch(/signature/i);
        });

        test.each(COMPILED)("%s survives a JSON snapshot round trip", (name) => {
            // The snapshot carries the text block as an opaque range precisely so it describes a whole file.
            // Without that, this reconstructs a DLG missing everything the text refs point at.
            const original = bytesOf(name);

            const json = createCanonicalDlgJsonSnapshot(dlgParser.parse(original));
            const reloaded = loadCanonicalDlgJsonSnapshot(json);

            expect([...reloaded.bytes!]).toEqual([...original]);
        });

        test.each(COMPILED)("%s round-trips byte-identically", (name) => {
            const original = bytesOf(name);

            const round = dlgParser.serialize!(dlgParser.parse(original));

            expect(round.byteLength).toBe(original.byteLength);
            expect([...round]).toEqual([...original]);
        });
    },
);
