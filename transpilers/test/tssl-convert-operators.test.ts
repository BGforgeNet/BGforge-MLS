/**
 * TSSL operator-conversion tests: the TypeScript -> SSL operator mappings
 * (&& -> and, || -> or, & -> bwand, | -> bwor, ^ -> bxor, ! -> not,
 * ~ -> bnot), the FLOAT1 float-division marker, ternaries, and let/const ->
 * `variable` statements (tssl/src/convert-operators.ts).
 *
 * These drive the real transpile() entry point so the assertions keep holding
 * across internal refactors. TSSL resolves its source through the real
 * filesystem (ts-morph addSourceFileAtPath), so fixtures are written to a
 * temp dir - same setup as api.test.ts.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createBatchState, transpile } from "../tssl/src/index";

// One ts-morph project for the whole file: creating one per case re-parses the TypeScript default
// library every time, which is most of a small fixture's transpile cost.
const batch = createBatchState();

let tmpDir: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tssl-convert-operators-"));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

let fileSeq = 0;
async function emit(src: string): Promise<string> {
    const filePath = path.join(tmpDir, `case${fileSeq++}.tssl`);
    fs.writeFileSync(filePath, src, "utf-8");
    return transpile(filePath, src, batch);
}

describe("operator mappings", () => {
    it("converts logical && / || to and / or, keeping the author's parentheses", async () => {
        const out = await emit(
            `function start() {\n    let x = (global_var(1) && global_var(2)) || global_var(3);\n}\n`,
        );
        expect(out).toContain("(global_var(1) and global_var(2)) or global_var(3)");
    });

    it("converts bitwise & / | / ^ to bwand / bwor / bxor", async () => {
        const out = await emit(`function start() {\n    let x = (global_var(1) & 2) | (global_var(2) ^ 5);\n}\n`);
        expect(out).toContain("(global_var(1) bwand 2) bwor (global_var(2) bxor 5)");
    });

    it("converts ! to not and ~ to bnot", async () => {
        const out = await emit(`function start() {\n    let x = !global_var(1);\n    let y = ~global_var(2);\n}\n`);
        expect(out).toContain("not global_var(1)");
        expect(out).toContain("bnot global_var(2)");
    });

    it("rewrites the FLOAT1 marker to a 1.0 literal for float division", async () => {
        const out = await emit(`function start() {\n    let x = FLOAT1 * 3 / 2;\n}\n`);
        expect(out).toContain("1.0 * 3 / 2");
    });

    it("keeps ternaries with a parenthesized condition", async () => {
        const out = await emit(`function start() {\n    let x = global_var(1) ? 10 : 20;\n}\n`);
        expect(out).toContain("(global_var(1)) ? 10 : 20");
    });
});

describe("variable statements", () => {
    it("converts let declarations to `variable` statements", async () => {
        const out = await emit(`function start() {\n    let counter = 5;\n}\n`);
        expect(out).toContain("variable counter = 5;");
    });

    it("converts const declarations to `variable` statements", async () => {
        const out = await emit(`function start() {\n    const limit = global_var(1) | 2;\n}\n`);
        expect(out).toContain("variable limit = global_var(1) bwor 2;");
    });
});
