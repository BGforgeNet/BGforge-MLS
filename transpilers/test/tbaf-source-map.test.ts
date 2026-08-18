/**
 * Tracing a line of generated BAF back to the TBAF the author wrote.
 *
 * The compiler that reads the generated file reports against IT, so without this map a diagnostic names a
 * line of a file nobody opened. Asserted against real transpiles rather than a hand-built IR: the map is
 * only worth anything if it survives the whole bundle-parse-transform-emit path.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../tbaf/src/index";
import { pathToFileURL } from "url";

let tmpDir: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-tbaf-map-"));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write a .tbaf, compile it, and hand back the generated text with its per-line origins. */
async function compileTbaf(name: string, source: string) {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, source, "utf-8");
    const result = await compile(pathToFileURL(filePath).href, source);
    return {
        filePath,
        generated: fs.readFileSync(result.bafPath, "utf-8"),
        sourceMap: result.sourceMap,
    };
}

/** The 0-based line of `text` holding `needle`. */
function lineOf(text: string, needle: string): number {
    const index = text.split("\n").findIndex((line) => line.includes(needle));
    expect(index, `no line containing ${needle}`).toBeGreaterThanOrEqual(0);
    return index;
}

describe("TBAF source map", () => {
    const SOURCE = [
        "if (See(Player1)) {",
        "    Attack(Player1);",
        "}",
        "",
        "if (Global('done', 'LOCALS', 0)) {",
        "    SetGlobal('done', 'LOCALS', 1);",
        "}",
        "",
    ].join("\n");

    it("maps a generated action to the statement it came from, not the block around it", async () => {
        const { filePath, generated, sourceMap } = await compileTbaf("blocks.tbaf", SOURCE);

        const origin = sourceMap[lineOf(generated, "Attack(Player1)")];
        expect(origin?.file).toBe(filePath);
        // The action's own line, not the `if` on line 0. A compiler complaining about this action should
        // point at the action.
        expect(origin?.line).toBe(1);
    });

    it("maps a generated condition to the test it came from", async () => {
        const { generated, sourceMap } = await compileTbaf("cond.tbaf", SOURCE);

        const origin = sourceMap[lineOf(generated, "See(Player1)")];
        expect(origin?.line).toBe(0);
    });

    it("distinguishes two blocks rather than collapsing them onto one origin", async () => {
        const { generated, sourceMap } = await compileTbaf("blocks2.tbaf", SOURCE);

        const first = sourceMap[lineOf(generated, "Attack(Player1)")];
        const second = sourceMap[lineOf(generated, "SetGlobal")];
        expect(first?.line).toBe(1);
        expect(second?.line).toBe(5);
    });

    it("reports one origin for every line of the generated file", async () => {
        const { generated, sourceMap } = await compileTbaf("blocks3.tbaf", SOURCE);
        expect(sourceMap).toHaveLength(generated.split("\n").length - 1);
    });

    it("names the imported file a block came from", async () => {
        fs.writeFileSync(
            path.join(tmpDir, "shared.tbaf"),
            "export function guard() {\n    if (See(Player1)) {\n        Attack(Player1);\n    }\n}\n",
            "utf-8",
        );
        const source = 'import { guard } from "./shared.tbaf";\n\nguard();\n';
        const { generated, sourceMap } = await compileTbaf("importer.tbaf", source);

        const origin = sourceMap[lineOf(generated, "Attack(Player1)")];
        expect(origin?.file).toBe(path.join(tmpDir, "shared.tbaf"));
        expect(origin?.line).toBe(2);
    });
});
