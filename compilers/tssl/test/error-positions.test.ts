/**
 * Where a transpiler failure is reported, driven through the real transpilers.
 *
 * A compilation unit spans several files, so a failure's line has to name the file it actually sits in -
 * the entry the author has open, or an imported module entirely elsewhere. These drive the compiler a
 * consumer calls and assert the position it gets back names something the author can open.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { transpile as tsslTranspile } from "../src/index";
import { TranspileError } from "../../../transpilers/common/transpile-error";

let tmpDir: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-error-positions-test-"));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write a file into the shared temp dir and hand back its path. */
function write(name: string, contents: string): string {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, contents, "utf-8");
    return filePath;
}

/** Run a transpile expected to fail, and return the failure. */
async function failureOf(run: () => Promise<unknown>): Promise<TranspileError> {
    let caught: unknown;
    try {
        await run();
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(TranspileError);
    return caught as TranspileError;
}

describe("TSSL failure positions", () => {
    it("names the file the author has open, not the entry it was handed", async () => {
        const source = `export function start(): void {\n    let x = Math.floor(3);\n}\n`;
        const filePath = write("plain.tssl", source);

        const error = await failureOf(() => tsslTranspile(filePath, source));
        expect(error.message).toContain("Math.floor");
        expect(error.location.file).toBe(filePath);
        expect(error.location.line).toBe(2);
    });

    it("accounts for the lines an enum loses when it is flattened", async () => {
        // Every line below the enum shifts when its members become flat consts, so a line read off the
        // flattening lands above where the author wrote it - here, inside the enum rather than on the call.
        const source =
            `enum Color {\n    Red = 1,\n    Green = 2,\n}\n\n` +
            `export function start(): void {\n    let x = Math.floor(Color.Red);\n}\n`;
        const filePath = write("with-enum.tssl", source);

        const error = await failureOf(() => tsslTranspile(filePath, source));
        expect(error.location.file).toBe(filePath);
        expect(error.location.line).toBe(7);
    });

    // The entry is registered under a shadow name, so without care the failure comes back under
    // a path the caller never used - and a consumer comparing it against its own would read the file it is
    // compiling as some other file.
    it("names the entry by the path it was given, not the one symlinks resolve to", async () => {
        const realDir = path.join(tmpDir, "real");
        fs.mkdirSync(realDir, { recursive: true });
        const linkDir = path.join(tmpDir, "link");
        fs.symlinkSync(realDir, linkDir, "dir");

        const source = `export function start(): void {\n    let x = Math.floor(3);\n}\n`;
        fs.writeFileSync(path.join(realDir, "linked.tssl"), source, "utf-8");
        const filePath = path.join(linkDir, "linked.tssl");

        const error = await failureOf(() => tsslTranspile(filePath, source));
        expect(error.location.file).toBe(filePath);
    });

    it("names the imported file a failure came from", async () => {
        write("tssl-helper.ts", `export function helper(): number {\n    return Math.floor(3);\n}\n`);
        const source = `import { helper } from "./tssl-helper";\n\nexport function start(): void {\n    let x = helper();\n}\n`;
        const filePath = write("importer.tssl", source);

        const error = await failureOf(() => tsslTranspile(filePath, source));
        expect(error.location.file).toBe(path.join(tmpDir, "tssl-helper.ts"));
        expect(error.location.line).toBe(2);
    });
});
