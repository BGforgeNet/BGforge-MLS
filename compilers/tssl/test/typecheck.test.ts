/**
 * The type check the tssl CLI runs before compiling: each script against the tsconfig.json that includes it,
 * with strict defaults where none does.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TsslTypechecker } from "../src/typecheck";

// One checker for the file, as the CLI keeps one per run: each case has its own tsconfig, so its own program.
const checker = new TsslTypechecker();

let tmpDir: string;
let caseSeq = 0;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tssl-typecheck-"));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** A mod directory holding `files`, relative path to content. */
function mod(files: Record<string, string>): string {
    const dir = path.join(tmpDir, `case${caseSeq++}`);
    for (const [name, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        fs.writeFileSync(path.join(dir, name), content, "utf-8");
    }
    return dir;
}

const STRICT = JSON.stringify({ compilerOptions: { strict: true, noEmit: true } });
const UNTYPED_PARAMETER =
    "function twice(x) {\n    return x * 2;\n}\nexport function start(): void {\n    twice(1);\n}\n";

describe("TsslTypechecker", () => {
    it("reports a type error at its line and column in the script, naming the tsconfig it used", () => {
        const dir = mod({
            "tsconfig.json": STRICT,
            "a.tssl": 'export function start(): void {\n    const bad: number = "a";\n    display_msg(bad);\n}\n',
            "engine.d.ts": "declare function display_msg(value: number | string): void;\n",
        });
        expect(checker.check(path.join(dir, "a.tssl"))).toEqual({
            config: path.join(dir, "tsconfig.json"),
            errors: [
                {
                    file: path.join(dir, "a.tssl"),
                    line: 2,
                    column: 11,
                    code: 2322,
                    message: "Type 'string' is not assignable to type 'number'.",
                },
            ],
        });
    });

    it("checks with the options of the tsconfig that includes the script", () => {
        const dir = mod({
            "tsconfig.json": JSON.stringify({ compilerOptions: { strict: false, noEmit: true } }),
            "a.tssl": UNTYPED_PARAMETER,
        });
        expect(checker.check(path.join(dir, "a.tssl")).errors).toEqual([]);
    });

    it("falls back to strict defaults when no tsconfig.json includes the script", () => {
        const dir = mod({
            "tsconfig.json": JSON.stringify({ compilerOptions: { strict: false }, include: ["src/**/*.tssl"] }),
            "a.tssl": UNTYPED_PARAMETER,
        });
        expect(checker.check(path.join(dir, "a.tssl"))).toEqual({
            config: undefined,
            errors: [
                {
                    file: path.join(dir, "a.tssl"),
                    line: 1,
                    column: 16,
                    code: 7006,
                    message: "Parameter 'x' implicitly has an 'any' type.",
                },
            ],
        });
    });

    it("does not report an engine procedure as unused, as the editor does not", () => {
        const dir = mod({
            "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noUnusedLocals: true } }),
            // A module, as every script importing folib is: a global script's functions are never unused.
            "a.tssl": "export {};\nfunction start(): void {}\nfunction helper(): void {}\n",
        });
        expect(checker.check(path.join(dir, "a.tssl")).errors).toEqual([
            {
                file: path.join(dir, "a.tssl"),
                line: 3,
                column: 10,
                code: 6133,
                message: "'helper' is declared but its value is never read.",
            },
        ]);
    });

    it("sees the declarations the tsconfig includes beside the script", () => {
        const dir = mod({
            "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }),
            "src/engine.d.ts": "declare function display_msg(value: string): void;\n",
            "src/a.tssl": "export function start(): void {\n    display_msg(1);\n}\n",
        });
        expect(checker.check(path.join(dir, "src/a.tssl")).errors).toEqual([
            {
                file: path.join(dir, "src/a.tssl"),
                line: 2,
                column: 17,
                code: 2345,
                message: "Argument of type 'number' is not assignable to parameter of type 'string'.",
            },
        ]);
    });
});
