/**
 * Unit tests for fallout-ssl/semantic-tokens.ts - parameter reference extraction.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import { SemanticTokenTypes } from "vscode-languageserver/node";

vi.mock("../../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn() },
        sendDiagnostics: vi.fn(),
    }),
    getDocuments: () => ({ get: vi.fn() }),
    initLspConnection: vi.fn(),
}));

import { initParser } from "../../src/fallout-ssl/parser";
import { getSemanticTokenSpans } from "../../src/fallout-ssl/semantic-tokens";

beforeAll(async () => {
    await initParser();
});

function getLine(text: string, line: number): string {
    return text.split("\n")[line] ?? "";
}

function tokenTexts(text: string): string[] {
    return getSemanticTokenSpans(text).map((span) =>
        getLine(text, span.line).slice(span.startChar, span.startChar + span.length)
    );
}

describe("fallout-ssl/semantic-tokens", () => {
    it("emits only procedure parameter references from the body", () => {
        const text = `
procedure heal(variable who, variable amount) begin
    who := who + amount;
    display_msg(who);
end
`;

        const spans = getSemanticTokenSpans(text);

        expect(spans).toHaveLength(4);
        expect(spans.every(span => span.tokenType === SemanticTokenTypes.parameter)).toBe(true);
        expect(tokenTexts(text)).toEqual(["who", "who", "amount", "who"]);
    });

    it("does not emit tokens for parameter names in the procedure signature", () => {
        const text = `
procedure heal(variable who, variable amount) begin
    display_msg(amount);
end
`;

        expect(tokenTexts(text)).toEqual(["amount"]);
    });

    it("keeps same-named parameters scoped to their own procedure body", () => {
        const text = `
procedure first(variable value) begin
    display_msg(value);
end
procedure second(variable value) begin
    value := 1;
end
`;

        const spans = getSemanticTokenSpans(text);

        expect(spans).toHaveLength(2);
        expect(spans.map(span => span.line)).toEqual([2, 5]);
    });

    it("does not emit non-parameter locals or globals", () => {
        const text = `
variable amount;

procedure heal(variable who) begin
    variable amount;
    who := amount;
end
`;

        expect(tokenTexts(text)).toEqual(["who"]);
    });

    it("emits only macro parameter references from the macro body", () => {
        const text = `
#define ADD(a, b) ((a) + (b))
#define NO_PARAMS 42
`;

        const spans = getSemanticTokenSpans(text);

        expect(spans).toHaveLength(2);
        expect(spans.every(span => span.tokenType === SemanticTokenTypes.parameter)).toBe(true);
        expect(tokenTexts(text)).toEqual(["a", "b"]);
    });

    it("does not emit tokens for macro parameter names in the define parameter list", () => {
        const text = `
#define SCALE(value) ((value) * 2)
`;

        expect(tokenTexts(text)).toEqual(["value"]);
    });

    it("emits no tokens for parameterless procedures (early return branch in collectProcedureParameterReferences)", () => {
        // A procedure with no parameter list exercises the !paramsNode branch (line 50)
        const text = `
procedure startup begin
    display_msg(1);
end
`;
        const spans = getSemanticTokenSpans(text);
        // No parameters → no parameter semantic tokens emitted
        expect(spans).toHaveLength(0);
    });
});
