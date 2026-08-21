/**
 * Where a compiled `.tssl` lands, and what else it writes.
 *
 * The dispatcher's own tests mock this module out, so these are what cover it. They assert placement
 * and the settings that decide it - not that the bytecode is right, which the compiler's own suites and
 * the corpus sweeps do, nor that the emitted SSL compiles to the same bytes, which `pnpm tssl-int-diff`
 * checks against a real mod at every optimisation level.
 */

import { describe, expect, it, beforeEach, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compileTsslToInt } from "../src/tssl/compile-int";
import { defaultSettings, type MLSsettings } from "../src/settings";

const SOURCE = "function start() {\n    let n = 1;\n    n = n + 1;\n}\n";

let tmpDir: string;
let caseSeq = 0;

afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tssl-compile-"));
});

/** A source file in its own directory, so one case's output cannot be mistaken for another's. */
function writeSource(source = SOURCE): string {
    const dir = path.join(tmpDir, `case${caseSeq++}`);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "script.tssl");
    fs.writeFileSync(file, source, "utf-8");
    return file;
}

function settingsWith(overrides: {
    outputDirectory?: string;
    compileOnValidate?: boolean;
    emitSsl?: boolean;
}): MLSsettings {
    return {
        ...defaultSettings,
        falloutSSL: {
            ...defaultSettings.falloutSSL,
            outputDirectory: overrides.outputDirectory ?? "",
            compileOnValidate: overrides.compileOnValidate ?? true,
        },
        tssl: { emitSsl: overrides.emitSsl ?? false },
    };
}

function compileFile(file: string, settings: MLSsettings, interactive = false) {
    return compileTsslToInt(`file://${file}`, file, fs.readFileSync(file, "utf-8"), settings, interactive);
}

describe("compileTsslToInt", () => {
    // An empty outputDirectory means "beside the source". It has to be resolved against the source's
    // own directory: a bare relative name would land wherever the editor happened to start the server.
    it("writes the bytecode beside the source when no output directory is set", async () => {
        const file = writeSource();
        const result = await compileFile(file, settingsWith({}));

        expect(result.intPath).toBe(path.join(path.dirname(file), "script.int"));
        expect(fs.statSync(result.intPath).size).toBeGreaterThan(0);
    });

    it("writes it to the configured output directory instead", async () => {
        const file = writeSource();
        const outDir = path.join(tmpDir, "compiled");
        fs.mkdirSync(outDir, { recursive: true });

        const result = await compileFile(file, settingsWith({ outputDirectory: outDir }));

        expect(result.intPath).toBe(path.join(outDir, "script.int"));
        expect(fs.existsSync(result.intPath)).toBe(true);
        expect(fs.existsSync(path.join(path.dirname(file), "script.int"))).toBe(false);
    });

    // compileOnValidate off means the author is editing without overwriting the artifact they ship.
    it("keeps no output on a validation run when compileOnValidate is off", async () => {
        const file = writeSource();
        await compileFile(file, settingsWith({ compileOnValidate: false }));

        expect(fs.existsSync(path.join(path.dirname(file), "script.int"))).toBe(false);
    });

    // ...but an explicit compile is the user asking for the file, so it is written whatever that says.
    it("still writes it when the user asked for the compile", async () => {
        const file = writeSource();
        const result = await compileFile(file, settingsWith({ compileOnValidate: false }), true);

        expect(fs.existsSync(result.intPath)).toBe(true);
    });

    it("writes no SSL by default - the bytecode is the product", async () => {
        const file = writeSource();
        const result = await compileFile(file, settingsWith({}));

        expect(result.sslPath).toBeUndefined();
        expect(fs.existsSync(path.join(path.dirname(file), "script.ssl"))).toBe(false);
    });

    it("writes the readable SSL beside the source when the setting asks for it", async () => {
        const file = writeSource();
        const result = await compileFile(file, settingsWith({ emitSsl: true }));

        expect(result.sslPath).toBe(path.join(path.dirname(file), "script.ssl"));
        expect(fs.readFileSync(result.sslPath!, "utf-8")).toContain("procedure start");
    });

    // The SSL goes beside the SOURCE even when the bytecode goes elsewhere: it is something to read
    // against the file being edited, not an artifact to ship next to the compiled output.
    it("keeps the SSL beside the source when the bytecode goes to an output directory", async () => {
        const file = writeSource();
        const outDir = path.join(tmpDir, "compiled");
        fs.mkdirSync(outDir, { recursive: true });

        const result = await compileFile(file, settingsWith({ outputDirectory: outDir, emitSsl: true }));

        expect(result.intPath).toBe(path.join(outDir, "script.int"));
        expect(result.sslPath).toBe(path.join(path.dirname(file), "script.ssl"));
    });

    // A refusal carries the line in the source the author has open - there is no generated file for it
    // to be reported against, and nothing to relocate it from.
    it("refuses an unlowerable construct at the line it sits on", async () => {
        const file = writeSource("function start() {\n    let n = 1;\n    n = nope;\n}\n");

        await expect(compileFile(file, settingsWith({}))).rejects.toMatchObject({
            message: "unknown identifier 'nope'",
            location: { file, line: 3 },
        });
        expect(fs.existsSync(path.join(path.dirname(file), "script.int"))).toBe(false);
    });
});
