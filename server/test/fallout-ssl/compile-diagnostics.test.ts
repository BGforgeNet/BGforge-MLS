/**
 * Unit tests for the conversion from the compiler's located problems to editor diagnostics.
 *
 * The flattening of a refusal into problems is the compiler package's own (`problemsOf`, tested there);
 * what is the server's here is attaching a URI - a problem naming its own file is in a header the user
 * did not open - and the protocol's column convention.
 */

import { describe, expect, it } from "vitest";
import { problemDiagnostics } from "../../src/fallout-ssl/compile-diagnostics";

const SOURCE = "/project/test.ssl";

describe("problemDiagnostics", () => {
    it("shows every problem at once, each at its own line", () => {
        const errors = problemDiagnostics(
            [
                { line: 2, column: 10, message: "syntax error" },
                { line: 3, column: 10, message: "syntax error" },
                { line: 4, column: 1, message: "missing end" },
            ],
            SOURCE,
        );

        expect(errors.map((e) => e.line)).toEqual([2, 3, 4]);
        expect(errors.at(-1)!.message).toBe("missing end");
    });

    it("blames a header for a problem naming it, not the script that included it", () => {
        const errors = problemDiagnostics(
            [{ file: "/project/inc/h.h", line: 4, column: 0, message: "unknown directive #bogus" }],
            SOURCE,
        );

        expect(errors).toHaveLength(1);
        expect(errors[0]!.uri).toMatch(/inc\/h\.h$/);
        expect(errors[0]!.line).toBe(4);
    });

    it("attributes a fileless problem to the script being compiled", () => {
        const errors = problemDiagnostics([{ line: 2, column: 7, message: "unknown identifier 'foo'" }], SOURCE);

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
});
