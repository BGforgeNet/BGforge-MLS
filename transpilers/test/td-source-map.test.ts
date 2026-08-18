/**
 * Tracing a line of generated D back to the TD the author wrote.
 *
 * WeiDU reports against the generated file, so without this map a diagnostic names a line of something
 * nobody opened. Driven through real transpiles: the map is worth nothing unless it survives the whole
 * bundle-parse-emit path.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../td/src/index";
import { pathToFileURL } from "url";

let tmpDir: string;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-td-map-"));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function compileTd(name: string, source: string) {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, source, "utf-8");
    const result = await compile(pathToFileURL(filePath).href, source);
    return {
        filePath,
        generated: fs.readFileSync(result.dPath, "utf-8"),
        sourceMap: result.sourceMap,
    };
}

/** The 0-based line of `text` holding `needle`. */
function lineOf(text: string, needle: string): number {
    const index = text.split("\n").findIndex((line) => line.includes(needle));
    expect(index, `no line containing ${needle}`).toBeGreaterThanOrEqual(0);
    return index;
}

describe("TD source map", () => {
    //  0 function first() {
    //  1     say("hello")
    //  2 }
    //  3
    //  4 function second() {
    //  5     say("goodbye")
    //  6 }
    //  7
    //  8 append("MYDLG", first, second)
    const SOURCE = [
        "function first() {",
        '    say("hello")',
        "}",
        "",
        "function second() {",
        '    say("goodbye")',
        "}",
        "",
        'append("MYDLG", first, second)',
        "",
    ].join("\n");

    it("maps a generated state back to the function it came from", async () => {
        const { filePath, generated, sourceMap } = await compileTd("states.td", SOURCE);

        const origin = sourceMap[lineOf(generated, "hello")];
        expect(origin?.file).toBe(filePath);
        expect(origin?.line).toBe(0);
    });

    it("distinguishes two states rather than collapsing them onto one origin", async () => {
        const { sourceMap, generated } = await compileTd("states2.td", SOURCE);

        expect(sourceMap[lineOf(generated, "hello")]?.line).toBe(0);
        expect(sourceMap[lineOf(generated, "goodbye")]?.line).toBe(4);
    });

    it("reports one origin for every line of the generated file", async () => {
        const { generated, sourceMap } = await compileTd("states3.td", SOURCE);
        expect(sourceMap).toHaveLength(generated.split("\n").length - 1);
    });

    it("names the imported file a state came from", async () => {
        // A TD file imports .ts, not .td - the bundler resolves .tbaf and .ts, and a state function is
        // just a function as far as it is concerned.
        fs.writeFileSync(
            path.join(tmpDir, "td-shared.ts"),
            'export function shared() {\n    say("from the import")\n}\n',
            "utf-8",
        );
        const source = 'import { shared } from "./td-shared";\n\nappend("MYDLG", shared)\n';
        const { generated, sourceMap } = await compileTd("td-importer.td", source);

        const origin = sourceMap[lineOf(generated, "from the import")];
        expect(origin?.file).toBe(path.join(tmpDir, "td-shared.ts"));
        expect(origin?.line).toBe(0);
    });
});
