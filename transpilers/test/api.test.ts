/**
 * Public API tests for @bgforge/transpile.
 * Imports from `../src/index` (TypeScript source) so this layer is independent
 * of the bundler step.
 *
 * Each transpiler requires a real filesystem path - they call ts-morph's
 * esbuild resolvers (TD) against disk.
 * Fixtures are written to os.tmpdir() in beforeAll and cleaned up in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { tbaf, td, transpile, outputPathFor, UnknownTranspileExtensionError } from "../src/index";
import { transpile as tbafDirect } from "../tbaf/src/index";
import { transpile as tdDirect } from "../td/src/index";

// Minimal fixtures that each transpiler accepts without imports.
// TBAF: simplest IF/THEN/END block - no imports, so bundle() passes through unchanged.
const TBAF_SRC = `if (See(Player1)) {\n    Attack(Player1);\n}\n`;
// TD: minimal begin() call - no imports, so bundle() passes through unchanged.
const TD_SRC = `export default begin("MYFOO", []);\n`;

let tmpDir: string;
let tbafPath: string;
let tdPath: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-transpile-test-"));
    tbafPath = path.join(tmpDir, "foo.tbaf");
    tdPath = path.join(tmpDir, "foo.td");
    fs.writeFileSync(tbafPath, TBAF_SRC, "utf-8");
    fs.writeFileSync(tdPath, TD_SRC, "utf-8");
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("@bgforge/transpile public API", () => {
    describe("named exports", () => {
        it("tbaf re-export is referentially equal to the internal export", () => {
            expect(tbaf).toBe(tbafDirect);
        });
        it("td re-export is referentially equal to the internal export", () => {
            expect(td).toBe(tdDirect);
        });
    });

    describe("transpile() dispatcher", () => {
        it("dispatches .tbaf to the TBAF transpiler", async () => {
            const r = await transpile(tbafPath, TBAF_SRC);
            expect(r.kind).toBe("tbaf");
            const direct = await tbafDirect(tbafPath, TBAF_SRC);
            expect(r.output).toBe(direct);
        });

        it("dispatches .td to the TD transpiler and surfaces warnings", async () => {
            const r = await transpile(tdPath, TD_SRC);
            if (r.kind !== "td") throw new Error(`Expected kind "td", got "${r.kind}"`);
            const direct = await tdDirect(tdPath, TD_SRC);
            expect(r.output).toBe(direct.output);
            expect(r.warnings).toStrictEqual(direct.warnings);
        });

        it("throws UnknownTranspileExtensionError naming the extension and accepted extensions", async () => {
            await expect(transpile("/virtual/foo.xyz", "")).rejects.toMatchObject({
                name: "UnknownTranspileExtensionError",
                message: expect.stringMatching(/\.xyz/),
            });
            await expect(transpile("/virtual/foo.xyz", "")).rejects.toMatchObject({
                message: expect.stringMatching(/\.tbaf/),
            });
            await expect(transpile("/virtual/foo.xyz", "")).rejects.toMatchObject({
                message: expect.stringMatching(/\.td/),
            });
        });
    });

    describe("outputPathFor()", () => {
        // The target extensions are the canonical compiled formats: TBAF -> WeiDU BAF (.baf),
        // TD -> WeiDU D (.d). `.tssl` is not among them - it belongs to the tssl compiler now, whose
        // default output is bytecode rather than text.
        it("refuses a .tssl path, which this package no longer maps", () => {
            expect(() => outputPathFor("/mods/dir/script.tssl")).toThrow(/Unknown transpile extension/);
        });
        it("maps a .tbaf path to its .baf output path", () => {
            expect(outputPathFor("/mods/dir/ai.tbaf")).toBe("/mods/dir/ai.baf");
        });
        it("maps a .td path to its .d output path", () => {
            expect(outputPathFor("/mods/dir/dlg.td")).toBe("/mods/dir/dlg.d");
        });
        it("matches the source extension case-insensitively, lowercasing only the target", () => {
            expect(outputPathFor("/mods/DLG.TD")).toBe("/mods/DLG.d");
        });
        it("throws UnknownTranspileExtensionError for an unsupported extension", () => {
            expect(() => outputPathFor("/mods/foo.xyz")).toThrow(UnknownTranspileExtensionError);
        });
    });
});
