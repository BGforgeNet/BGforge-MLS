/**
 * Unit tests for tree-sitter-validation.ts - the parse-and-publish gate.
 *
 * Drives the real fallout-ssl parser through the real diagnostic-store (only
 * lsp-connection is mocked) so the test exercises the actual no-op gate, publish
 * path, and clear-on-clean behavior end to end.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const sent: { uri: string; diagnostics: { source?: string }[] }[] = [];
vi.mock("../src/lsp-connection", () => ({
    getConnection: () => ({
        sendDiagnostics: (p: { uri: string; diagnostics: { source?: string }[] }) => sent.push(p),
    }),
}));

import { initParser } from "../../shared/parsers/fallout-ssl";
import { updateTreeSitterDiagnostics } from "../src/tree-sitter-validation";
import { clearAllDiagnostics } from "../src/diagnostic-store";

const URI = "file:///x.ssl";

describe("updateTreeSitterDiagnostics", () => {
    beforeAll(async () => await initParser());
    beforeEach(() => {
        clearAllDiagnostics(URI);
        sent.length = 0;
    });

    it("no-ops for a language without a registered parser - publishes nothing", () => {
        updateTreeSitterDiagnostics(URI, "plaintext", "@@@ !!! ###");
        expect(sent).toHaveLength(0);
    });

    it("publishes parse-error diagnostics for a registered language with malformed input", () => {
        updateTreeSitterDiagnostics(URI, "fallout-ssl", "procedure foo begin\n  if (x then\nend");
        expect(sent).toHaveLength(1);
        expect(sent[0]!.diagnostics.length).toBeGreaterThan(0);
        expect(sent[0]!.diagnostics.every((d) => d.source === "BGforge MLS (syntax)")).toBe(true);
    });

    it("publishes an empty set (clears the tree-sitter source) for a clean parse", () => {
        updateTreeSitterDiagnostics(URI, "fallout-ssl", "procedure foo begin\n    variable x;\nend\n");
        expect(sent).toHaveLength(1);
        expect(sent[0]!.diagnostics).toEqual([]);
    });
});
