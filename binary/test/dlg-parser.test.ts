import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { dlgParser } from "../src/dlg";
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

describe.skipIf(!available)("dlgParser", () => {
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

    const bytesOf = (name: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(workDir, `${name}.dlg`)));

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
});
