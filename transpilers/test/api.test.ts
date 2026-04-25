/**
 * Public API tests for @bgforge/transpile.
 * Imports from `../src/index` (TypeScript source) so this layer is independent
 * of the bundler step.
 *
 * Each transpiler requires a real filesystem path — they call ts-morph's
 * addSourceFileAtPath (TSSL) and esbuild resolvers (TD) against disk.
 * Fixtures are written to os.tmpdir() in beforeAll and cleaned up in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { tssl, tbaf, td, transpile } from "../src/index";
import { transpile as tsslDirect } from "../tssl/src/index";
import { transpile as tbafDirect } from "../tbaf/src/index";
import { transpile as tdDirect } from "../td/src/index";

// Minimal fixtures that each transpiler accepts without imports.
// TSSL: a single TypeScript function (no imports). TSSL transpiles TypeScript
// to SSL; the input is TypeScript syntax, not SSL syntax.
const TSSL_SRC = `function start() {}\n`;
// TBAF: simplest IF/THEN/END block — no imports, so bundle() passes through unchanged.
const TBAF_SRC = `if (See(Player1)) {\n    Attack(Player1);\n}\n`;
// TD: minimal begin() call — no imports, so bundle() passes through unchanged.
const TD_SRC = `export default begin("MYFOO", []);\n`;

let tmpDir: string;
let tsslPath: string;
let tbafPath: string;
let tdPath: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-transpile-test-"));
    tsslPath = path.join(tmpDir, "foo.tssl");
    tbafPath = path.join(tmpDir, "foo.tbaf");
    tdPath = path.join(tmpDir, "foo.td");
    fs.writeFileSync(tsslPath, TSSL_SRC, "utf-8");
    fs.writeFileSync(tbafPath, TBAF_SRC, "utf-8");
    fs.writeFileSync(tdPath, TD_SRC, "utf-8");
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("@bgforge/transpile public API", () => {
    describe("named exports", () => {
        it("tssl re-export is referentially equal to the internal export", () => {
            expect(tssl).toBe(tsslDirect);
        });
        it("tbaf re-export is referentially equal to the internal export", () => {
            expect(tbaf).toBe(tbafDirect);
        });
        it("td re-export is referentially equal to the internal export", () => {
            expect(td).toBe(tdDirect);
        });
    });

    describe("transpile() dispatcher", () => {
        it("dispatches .tssl to the TSSL transpiler", async () => {
            const r = await transpile(tsslPath, TSSL_SRC);
            expect(r.kind).toBe("tssl");
            const direct = await tsslDirect(tsslPath, TSSL_SRC, undefined);
            expect(r.output).toBe(direct);
        });

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

        it("throws UnknownTranspileExtensionError for unknown extension", async () => {
            await expect(transpile("/virtual/foo.xyz", "")).rejects.toMatchObject({
                name: "UnknownTranspileExtensionError",
                message: expect.stringContaining(".xyz"),
            });
        });

        it("throws an error whose message lists the accepted extensions", async () => {
            try {
                await transpile("/virtual/foo.xyz", "");
                throw new Error("expected throw");
            } catch (err) {
                const m = (err as Error).message;
                expect(m).toMatch(/\.tssl/);
                expect(m).toMatch(/\.tbaf/);
                expect(m).toMatch(/\.td/);
            }
        });
    });
});
