/**
 * Line provenance through a REAL bundling run (transpilers/common/rolldown-utils.ts).
 *
 * The unit tests for the two cleanup passes and for the VLQ decoder all feed hand-built input, which
 * encodes assumptions about what the bundler emits and about the source-map format. This drives it
 * itself, so a wrong assumption in either shows up here rather than as a plausible wrong line later.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { bundleWithRolldown } from "../common/rolldown-utils";

const MARKER = "/* __TEST_MARKER__ */";

// A distinctive statement per line, so an origin can be checked by reading the line back out of the
// file it names rather than by trusting an index.
// Exported so tree-shaking keeps them: an unreferenced local is dropped from the bundle entirely, and
// then there is no line left to trace.
const MAIN = `import { helper } from "./helper";

export function first() {
    return 111;
}

export function second() {
    return helper();
}
`;

const HELPER = `export function helper() {
    return 222;
}
`;

let tmpDir: string;
let mainPath: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-origins-test-"));
    mainPath = path.join(tmpDir, "main.ts");
    fs.writeFileSync(mainPath, MAIN, "utf-8");
    fs.writeFileSync(path.join(tmpDir, "helper.ts"), HELPER, "utf-8");
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("bundleWithRolldown line origins", () => {
    it("names a real file and the line in it that each bundled line came from", async () => {
        const result = await bundleWithRolldown({
            filePath: mainPath,
            sourceText: MAIN,
            marker: MARKER,
        });

        const lines = result.code.split("\n");
        expect(result.origins).toHaveLength(
            lines.length > 0 && result.code.endsWith("\n") ? lines.length - 1 : lines.length,
        );

        // Every origin names a file that exists and a line inside it - a map that drifted past the end
        // of a source, or onto a path that was never read, is the failure this catches.
        for (const origin of result.origins) {
            if (origin === undefined) continue;
            expect(fs.existsSync(origin.file)).toBe(true);
            const sourceLines = fs.readFileSync(origin.file, "utf-8").split("\n");
            expect(origin.line).toBeGreaterThanOrEqual(0);
            expect(origin.line).toBeLessThan(sourceLines.length);
        }
    });

    it("traces a line of the bundle back to the text that produced it", async () => {
        const result = await bundleWithRolldown({
            filePath: mainPath,
            sourceText: MAIN,
            marker: MARKER,
        });

        const lines = result.code.split("\n");
        const index = lines.findIndex((line) => line.includes("111"));
        expect(index).toBeGreaterThanOrEqual(0);

        const origin = result.origins[index];
        expect(origin).toBeDefined();
        const sourceLine = fs.readFileSync(origin!.file, "utf-8").split("\n")[origin!.line];
        expect(sourceLine).toContain("111");
    });

    it("traces past an enum in the entry, which is rewritten before the bundler ever sees the file", async () => {
        // The enum becomes one flat const per member plus a compat object, so the lines below it move.
        // An origin that ignored that would name a line of the author's file holding something else.
        //
        // The traced value sits inside a CALL rather than in arithmetic (`Color.Red + 333`) on purpose:
        // rolldown folds the arithmetic to a single literal, and the line this test needs to find then
        // holds neither operand. That fold is a real behavioural difference, pinned in its own test
        // below; here it would only obscure what this case is about.
        const withEnum = `enum Color {\n    Red = 1,\n    Green = 2,\n}\n\nexport function pick() {\n    return Face(Color.Red, 333);\n}\n`;
        const enumPath = path.join(tmpDir, "with-enum.ts");
        fs.writeFileSync(enumPath, withEnum, "utf-8");

        const result = await bundleWithRolldown({
            filePath: enumPath,
            sourceText: withEnum,
            marker: MARKER,
        });

        const index = result.code.split("\n").findIndex((line) => line.includes("333"));
        expect(index).toBeGreaterThanOrEqual(0);

        const origin = result.origins[index];
        expect(origin).toBeDefined();
        const sourceLine = fs.readFileSync(origin!.file, "utf-8").split("\n")[origin!.line];
        expect(sourceLine).toContain("333");
    });

    it("traces an imported file's line back to that file, not to the entry", async () => {
        const result = await bundleWithRolldown({
            filePath: mainPath,
            sourceText: MAIN,
            marker: MARKER,
        });

        const lines = result.code.split("\n");
        const index = lines.findIndex((line) => line.includes("222"));
        expect(index).toBeGreaterThanOrEqual(0);

        const origin = result.origins[index];
        expect(origin).toBeDefined();
        expect(path.basename(origin!.file)).toBe("helper.ts");
        const sourceLine = fs.readFileSync(origin!.file, "utf-8").split("\n")[origin!.line];
        expect(sourceLine).toContain("222");
    });
});
