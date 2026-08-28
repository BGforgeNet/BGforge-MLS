/**
 * The pass that restores one-statement-per-line in a bundle (transpilers/common/split-statements.ts).
 *
 * The map drives it: a line is split only where the map says two of its statements came from different
 * source lines, and only at an offset that begins a statement. The second constraint is what keeps a
 * newline out of the middle of an expression, where it could change how the file parses.
 */
import { describe, expect, it } from "vitest";
import { splitCollapsedStatements } from "../common/split-statements";
import type { SourceOrigin } from "../common/source-map";

/** Segments for one generated line, as the decoder would report them. */
function line(...segments: Array<[column: number, sourceLine: number]>): readonly SourceOrigin[] {
    return segments.map(([column, sourceLine]) => ({ column, source: 0, line: sourceLine }));
}

describe("splitCollapsedStatements", () => {
    it("splits a collapsed if-body onto its own line and says where each line began", () => {
        // The shape rolldown emits for `if (x) { y; }`. Column 18 is where `Attack(...)` starts.
        const code = "if (See(Player1)) Attack(Player1);\n";
        const origins = [line([0, 1], [18, 2]), []];

        const result = splitCollapsedStatements(code, origins);

        expect(result.code).toBe("if (See(Player1)) \nAttack(Player1);\n");
        // Both new lines came from generated line 0; the columns are what tell their origins apart.
        expect(result.positions.slice(0, 2)).toEqual([
            { line: 0, column: 0 },
            { line: 0, column: 18 },
        ]);
    });

    it("leaves a line whose segments all name one source line exactly as it was", () => {
        const code = "if (See(Player1)) Attack(Player1);\n";
        // Same columns, but every segment names source line 1 - nothing to disentangle.
        const origins = [line([0, 1], [18, 1]), []];

        const result = splitCollapsedStatements(code, origins);

        expect(result.code).toBe(code);
        expect(result.positions[0]).toEqual({ line: 0, column: 0 });
    });

    it("does not split at a boundary that is not a statement start", () => {
        // A map may name a new source line partway through an expression - an inlined argument, say.
        // Splitting there would put a newline inside `foo(...)`, so the statement-start check refuses.
        const code = "var total = first + second;\n";
        const origins = [line([0, 1], [20, 2]), []];

        const result = splitCollapsedStatements(code, origins);

        expect(result.code).toBe(code);
    });

    it("never splits a `return`, where a newline would change what the code means", () => {
        // The ASI case the statement-start constraint exists to exclude: `return\nvalue` returns
        // undefined. `value` is an expression, not a statement, so it is not a candidate.
        const code = "function f() { return value; }\n";
        const origins = [line([0, 1], [22, 2]), []];

        const result = splitCollapsedStatements(code, origins);

        expect(result.code).toBe(code);
    });

    it("returns the input unchanged when the map is empty", () => {
        const code = "Attack(Player1);\n";

        const result = splitCollapsedStatements(code, []);

        expect(result.code).toBe(code);
        expect(result.positions).toHaveLength(code.split("\n").length);
    });

    it("reports a position for every line it emits", () => {
        const code = "if (a) b();\nif (c) d();\n";
        const origins = [line([0, 1], [7, 2]), line([0, 4], [7, 5]), []];

        const result = splitCollapsedStatements(code, origins);

        expect(result.positions).toHaveLength(result.code.split("\n").length);
    });
});
