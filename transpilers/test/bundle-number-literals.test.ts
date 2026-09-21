/**
 * A number reaches the emitted mod file in plain decimal, whether or not its file was bundled.
 *
 * The bundler prints the shortest form of a number, so a file with imports had `1000` reach the mod file as
 * `1e3` - which WeiDU refuses as a parse error, while the same value in a file without imports passed through
 * untouched. Checked through the real transpile of both languages, since each reads the bundled text.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { initParser, parseWithCache } from "../../shared/parsers/weidu-baf";
import { transpile } from "../src/index";
import { REPO_ROOT } from "./repo-root";

const FIXTURE = path.join(REPO_ROOT, "transpilers/test/fixtures/number-literals");

beforeAll(async () => {
    await initParser();
});

async function emit(entryName: string): Promise<string> {
    const entry = path.join(FIXTURE, entryName);
    const result = await transpile(entry, fs.readFileSync(entry, "utf-8"));
    return result.output as string;
}

/** Tolerates the separator spacing, which differs between BAF and D (see bundle-constant-folding.test.ts). */
function setsGlobalTo(emitted: string, name: string, value: string): boolean {
    return new RegExp(`SetGlobal\\("${name}",\\s*"GLOBAL",\\s*${value}\\)`).test(emitted);
}

describe("round numbers in a bundled file", () => {
    describe("BAF", () => {
        it("emits a literal in a trigger in decimal", async () => {
            expect(await emit("script.tbaf")).toContain('GlobalGT("x", "GLOBAL", 1000)');
        });

        it("emits an imported const in decimal", async () => {
            expect(setsGlobalTo(await emit("script.tbaf"), "imported", "5000")).toBe(true);
        });

        it("emits a multi-digit mantissa in decimal", async () => {
            expect(setsGlobalTo(await emit("script.tbaf"), "million", "1500000")).toBe(true);
        });

        it("emits a negative literal in decimal", async () => {
            expect(setsGlobalTo(await emit("script.tbaf"), "negative", "-2000")).toBe(true);
        });

        it("emits BAF the grammar accepts", async () => {
            const tree = parseWithCache(await emit("script.tbaf"));
            expect(tree!.rootNode.hasError).toBe(false);
        });
    });

    describe("D", () => {
        it("emits a literal in decimal", async () => {
            expect(setsGlobalTo(await emit("dialog.td"), "literal", "1000")).toBe(true);
        });

        it("emits an imported const in decimal", async () => {
            expect(setsGlobalTo(await emit("dialog.td"), "imported", "5000")).toBe(true);
        });
    });
});
