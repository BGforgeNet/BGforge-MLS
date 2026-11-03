/**
 * The type check the fgtp CLI runs before transpiling: each script against the tsconfig.json that includes it,
 * with strict defaults where none does, and the TD runtime declared for a project holding `.td` files, as the
 * editor's TypeScript plugin does.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TranspilerTypechecker } from "../src/typecheck";

// One checker for the file, as the CLI keeps one per run: each case has its own directory, so its own program.
const checker = new TranspilerTypechecker();

let tmpDir: string;
let caseSeq = 0;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "transpile-typecheck-"));
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

const STRICT = JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["**/*"] });
const ENGINE = "declare function See(name: string): boolean;\ndeclare function SmallWait(seconds: number): void;\n";
const TBAF_UNBOUND = "if (See(Unbound)) {\n    SmallWait(1);\n}\n";
const TD_DIALOG = 'begin("DLG", state("0", () => {\n    exit();\n}));\n';
const UNTYPED_PARAMETER = "function twice(x) {\n    return x * 2;\n}\ntwice(1);\n";

describe("TD dialog text", () => {
    // A stand-in for iets's tra(); the TD runtime declares StrRef.
    const TRA = "declare function tra(index: number): StrRef;\n";
    const textIn = (text: string) => `begin("DLG", state("0", () => {\n    say(${text});\n    exit();\n}));\n`;
    const errorsFor = (text: string) => {
        const dir = mod({ "tsconfig.json": STRICT, "tra.d.ts": TRA, "a.td": textIn(text) });
        return checker.check(path.join(dir, "a.td")).errors.map((error) => error.message);
    };

    it("takes tlkForced() and male/female text built from references", () => {
        expect(errorsFor('tlkForced(12345, "You have it.")')).toEqual([]);
        expect(errorsFor("{ male: tra(1), female: tra(2) }")).toEqual([]);
        expect(errorsFor('{ male: tra(1), female: tra(2), maleSound: "M01", femaleSound: "F01" }')).toEqual([]);
    });

    it("rejects a raw string as text, deliberately, so text stays translatable", () => {
        expect(errorsFor('"Hello"')).toEqual([expect.stringMatching(/not assignable/)]);
    });
});

describe("TranspilerTypechecker", () => {
    it("reports an identifier the script does not bind at its line and column, naming the tsconfig it used", () => {
        const dir = mod({ "tsconfig.json": STRICT, "engine.d.ts": ENGINE, "a.tbaf": TBAF_UNBOUND });
        expect(checker.check(path.join(dir, "a.tbaf"))).toEqual({
            config: path.join(dir, "tsconfig.json"),
            errors: [
                {
                    file: path.join(dir, "a.tbaf"),
                    line: 1,
                    column: 9,
                    code: 2304,
                    message: "Cannot find name 'Unbound'.",
                },
            ],
        });
    });

    it("takes the TD API as declared in a .td script, and reports a name that is not part of it", () => {
        const dir = mod({
            "tsconfig.json": STRICT,
            "ok.td": TD_DIALOG,
            "typo.td": 'begin("DLG", state("0", () => {\n    bogus();\n}));\n',
        });
        expect(checker.check(path.join(dir, "ok.td")).errors).toEqual([]);
        expect(checker.check(path.join(dir, "typo.td")).errors).toEqual([
            {
                file: path.join(dir, "typo.td"),
                line: 2,
                column: 5,
                code: 2304,
                message: "Cannot find name 'bogus'.",
            },
        ]);
    });

    it("does not declare the TD API for a project that holds no .td script", () => {
        const dir = mod({ "tsconfig.json": STRICT, "a.tbaf": "exit();\n" });
        expect(checker.check(path.join(dir, "a.tbaf")).errors).toEqual([
            {
                file: path.join(dir, "a.tbaf"),
                line: 1,
                column: 1,
                code: 2304,
                message: "Cannot find name 'exit'.",
            },
        ]);
    });

    it("checks with the options of the tsconfig that includes the script", () => {
        const dir = mod({
            "tsconfig.json": JSON.stringify({ compilerOptions: { strict: false, noEmit: true }, include: ["**/*"] }),
            "a.tbaf": UNTYPED_PARAMETER,
        });
        expect(checker.check(path.join(dir, "a.tbaf")).errors).toEqual([]);
    });

    it("falls back to strict defaults when no tsconfig.json includes the script", () => {
        const dir = mod({
            "tsconfig.json": JSON.stringify({ compilerOptions: { strict: false }, include: ["src/**/*.tbaf"] }),
            "a.tbaf": UNTYPED_PARAMETER,
        });
        expect(checker.check(path.join(dir, "a.tbaf"))).toEqual({
            config: undefined,
            errors: [
                {
                    file: path.join(dir, "a.tbaf"),
                    line: 1,
                    column: 16,
                    code: 7006,
                    message: "Parameter 'x' implicitly has an 'any' type.",
                },
            ],
        });
    });

    it("passes over a nearer tsconfig.json that does not include the script for the next one up", () => {
        const dir = mod({
            "tsconfig.json": JSON.stringify({ compilerOptions: { strict: false }, include: ["**/*"] }),
            "tools/tsconfig.json": JSON.stringify({ include: ["tool.ts"] }),
            "tools/tool.ts": "export {};\n",
            "tools/a.tbaf": UNTYPED_PARAMETER,
        });
        expect(checker.check(path.join(dir, "tools/a.tbaf"))).toEqual({
            config: path.join(dir, "tsconfig.json"),
            errors: [],
        });
    });

    it("sees the declarations the tsconfig includes beside the script", () => {
        const dir = mod({
            "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }),
            "src/engine.d.ts": ENGINE,
            "src/a.tbaf": "SmallWait('1');\n",
        });
        expect(checker.check(path.join(dir, "src/a.tbaf")).errors).toEqual([
            {
                file: path.join(dir, "src/a.tbaf"),
                line: 1,
                column: 11,
                code: 2345,
                message: "Argument of type 'string' is not assignable to parameter of type 'number'.",
            },
        ]);
    });

    it("resolves a package through its exports map when no tsconfig.json includes the script", () => {
        const dir = mod({
            "node_modules/@bgforge/iets/package.json": JSON.stringify({
                name: "@bgforge/iets",
                type: "module",
                exports: { "./bg2": "./bg2.d.ts" },
            }),
            "node_modules/@bgforge/iets/bg2.d.ts": "export declare function See(name: string): boolean;\n",
            "a.tbaf": 'import { See } from "@bgforge/iets/bg2";\nSee(1);\n',
        });
        expect(checker.check(path.join(dir, "a.tbaf")).errors).toEqual([
            {
                file: path.join(dir, "a.tbaf"),
                line: 2,
                column: 5,
                code: 2345,
                message: "Argument of type 'number' is not assignable to parameter of type 'string'.",
            },
        ]);
    });

    it("checks each script that no tsconfig.json includes on its own, not against the others", () => {
        const dir = mod({ "a.tbaf": "const shared = 1;\n", "b.tbaf": "const shared = 2;\n" });
        expect(checker.check(path.join(dir, "a.tbaf")).errors).toEqual([]);
        expect(checker.check(path.join(dir, "b.tbaf")).errors).toEqual([]);
    });

    describe("the compiler settings the editor's TD plugin applies to a project holding .td scripts", () => {
        // A later library than the plugin's: `.at()` is declared by es2022 only.
        const LATER_LIB = JSON.stringify({ compilerOptions: { lib: ["es2022"] }, include: ["**/*"] });
        const AT = "[1].at(0);\n";

        it("replaces the tsconfig's library with the plugin's", () => {
            const dir = mod({ "tsconfig.json": LATER_LIB, "a.td": TD_DIALOG + AT });
            const errors = checker.check(path.join(dir, "a.td")).errors;
            expect(errors.map((e) => ({ line: e.line, code: e.code }))).toEqual([{ line: 4, code: 2550 }]);
        });

        it("leaves the tsconfig's library alone in a project with only .tbaf scripts", () => {
            const dir = mod({ "tsconfig.json": LATER_LIB, "a.tbaf": AT });
            expect(checker.check(path.join(dir, "a.tbaf")).errors).toEqual([]);
        });
    });
});
