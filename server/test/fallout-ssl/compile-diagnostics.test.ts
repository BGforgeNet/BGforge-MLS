/**
 * Unit tests for the conversion from a compiler refusal to editor diagnostics.
 *
 * This is what decides how much of a script's trouble a user learns per compile, so each refusal shape
 * that carries more than one problem is checked for carrying all of them.
 */

import { describe, expect, it } from "vitest";
import { CompileError } from "../../../compilers/ssl/src/compile";
import { LowerError } from "../../../compilers/ssl/src/lower";
import { PreprocessError } from "../../../compilers/ssl/src/preprocess";
import { toDiagnostics } from "../../src/fallout-ssl/compile-diagnostics";

const SOURCE = "/project/test.ssl";

describe("toDiagnostics", () => {
    it("shows every syntax error at once, each at its own line", () => {
        const errors = toDiagnostics(
            new CompileError([
                { line: 2, column: 10, message: "syntax error" },
                { line: 3, column: 10, message: "syntax error" },
                { line: 4, column: 1, message: "missing end" },
            ]),
            SOURCE,
        );

        expect(errors.map((e) => e.line)).toEqual([2, 3, 4]);
        expect(errors.at(-1)!.message).toBe("missing end");
    });

    it("shows every semantic error at once, without the line:column prefix the editor supplies", () => {
        // The position becomes the diagnostic's range, so repeating it in the message text would show
        // up twice in the editor.
        const found = [
            new LowerError("unknown identifier 'a'", { line: 2, column: 2 }),
            new LowerError("division by zero", { line: 3, column: 8 }),
            new LowerError("'break' outside a loop", { line: 4, column: 2 }),
        ];

        const errors = toDiagnostics(new LowerError(found[0]!.detail, { line: 2, column: 2 }, found), SOURCE);

        expect(errors.map((e) => [e.line, e.message])).toEqual([
            [2, "unknown identifier 'a'"],
            [3, "division by zero"],
            [4, "'break' outside a loop"],
        ]);
    });

    it("blames a header for its own preprocessor error, not the script that included it", () => {
        const inHeader = new PreprocessError("unknown directive #bogus", "/project/inc/h.h", 4);

        const errors = toDiagnostics(inHeader, SOURCE);

        expect(errors).toHaveLength(1);
        expect(errors[0]!.uri).toMatch(/inc\/h\.h$/);
        expect(errors[0]!.line).toBe(4);
    });

    it("reads the position out of a plain error's message prefix", () => {
        const errors = toDiagnostics(new Error("2:7: unknown identifier 'foo'"), SOURCE);

        expect(errors).toEqual([
            {
                uri: expect.stringContaining("test.ssl"),
                line: 2,
                columnStart: 0,
                columnEnd: 7,
                message: "unknown identifier 'foo'",
            },
        ]);
    });

    it("puts an unplaceable failure at the top of the file rather than dropping it", () => {
        const errors = toDiagnostics(new Error("out of memory"), SOURCE);

        expect(errors).toEqual([
            {
                uri: expect.stringContaining("test.ssl"),
                line: 1,
                columnStart: 0,
                columnEnd: 0,
                message: "out of memory",
            },
        ]);
    });
});
