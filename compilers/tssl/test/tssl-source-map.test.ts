/**
 * Tracing a line of generated SSL back to the TSSL the author wrote.
 *
 * The SSL compiler reports against the generated file, so without this map a diagnostic names a line of
 * something nobody opened. Driven through real transpiles, since the map only matters if it survives the
 * bundle-parse-emit path - and TSSL always bundles, so it always has one to survive.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../src/index";
import { pathToFileURL } from "url";

let tmpDir: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-tssl-map-"));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function compileTssl(name: string, source: string) {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, source, "utf-8");
    const result = await compile(pathToFileURL(filePath).href, source);
    return {
        filePath,
        generated: fs.readFileSync(result.sslPath, "utf-8"),
        sourceMap: result.sourceMap,
    };
}

/** The 0-based line of `text` holding `needle`. */
function lineOf(text: string, needle: string): number {
    const index = text.split("\n").findIndex((line) => line.includes(needle));
    expect(index, `no line containing ${needle}`).toBeGreaterThanOrEqual(0);
    return index;
}

describe("TSSL source map", () => {
    //  0 export function start(): void {
    //  1     display_msg("first");
    //  2 }
    //  3
    //  4 export function other(): void {
    //  5     display_msg("second");
    //  6 }
    const SOURCE = [
        "export function start(): void {",
        '    display_msg("first");',
        "}",
        "",
        "export function other(): void {",
        '    display_msg("second");',
        "}",
        "",
    ].join("\n");

    it("maps a generated procedure back to the function it came from", async () => {
        const { filePath, generated, sourceMap } = await compileTssl("procs.tssl", SOURCE);

        const origin = sourceMap[lineOf(generated, "first")];
        expect(origin?.file).toBe(filePath);
        expect(origin?.line).toBe(0);
    });

    it("distinguishes two procedures rather than collapsing them onto one origin", async () => {
        const { generated, sourceMap } = await compileTssl("procs2.tssl", SOURCE);

        expect(sourceMap[lineOf(generated, "first")]?.line).toBe(0);
        expect(sourceMap[lineOf(generated, "second")]?.line).toBe(4);
    });

    it("reports one origin for every line of the generated file", async () => {
        const { generated, sourceMap } = await compileTssl("procs3.tssl", SOURCE);
        expect(sourceMap).toHaveLength(generated.split("\n").length - 1);
    });

    it("names the imported file a procedure came from", async () => {
        fs.writeFileSync(
            path.join(tmpDir, "tssl-shared.ts"),
            'export function shared(): void {\n    display_msg("from the import");\n}\n',
            "utf-8",
        );
        const source = 'import { shared } from "./tssl-shared";\n\nexport function start(): void {\n    shared();\n}\n';
        const { generated, sourceMap } = await compileTssl("tssl-importer.tssl", source);

        const origin = sourceMap[lineOf(generated, "from the import")];
        expect(origin?.file).toBe(path.join(tmpDir, "tssl-shared.ts"));
        expect(origin?.line).toBe(0);
    });
});
