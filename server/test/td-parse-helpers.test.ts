/**
 * Unit tests for TD parse helpers — specifically the getCallArg guarded helper
 * that narrows ts-morph Node[] call arguments to Expression with runtime checks.
 */

import { describe, expect, it } from "vitest";
import { Project, SyntaxKind } from "ts-morph";
import { getCallArg } from "../../transpilers/td/src/parse-helpers";

/** Parse a source string and return the first call expression found. */
function parseCallExpr(source: string) {
    const project = new Project({ useInMemoryFileSystem: true });
    const file = project.createSourceFile("test.ts", source);
    const stmt = file.getStatements()[0];
    if (!stmt?.isKind(SyntaxKind.ExpressionStatement)) {
        throw new Error("Expected expression statement");
    }
    const expr = stmt.getExpression();
    if (!expr.isKind(SyntaxKind.CallExpression)) {
        throw new Error("Expected call expression");
    }
    return expr;
}

describe("getCallArg", () => {
    it("returns the argument as Expression for a valid index", () => {
        const call = parseCallExpr(`foo("bar", 42)`);
        const args = call.getArguments();
        const arg0 = getCallArg(args, 0, call);
        expect(arg0.getText()).toBe('"bar"');
    });

    it("returns the second argument when index is 1", () => {
        const call = parseCallExpr(`foo("bar", 42)`);
        const args = call.getArguments();
        const arg1 = getCallArg(args, 1, call);
        expect(arg1.getText()).toBe("42");
    });

    it("throws TranspileError when index is out of bounds", () => {
        const call = parseCallExpr(`foo("bar")`);
        const args = call.getArguments();
        expect(() => getCallArg(args, 5, call)).toThrow("Expected argument at index 5");
    });

    it("throws TranspileError when index is negative", () => {
        const call = parseCallExpr(`foo("bar")`);
        const args = call.getArguments();
        expect(() => getCallArg(args, -1, call)).toThrow("Expected argument at index -1");
    });
});
