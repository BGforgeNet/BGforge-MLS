/**
 * Unit tests for parse-error diagnostics on the BAF grammar.
 *
 * Drives the real weidu-baf parser through the same walk the server publishes from,
 * so a grammar regression surfaces here as the false squiggle a user would see.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import * as baf from "../../../shared/parsers/weidu-baf";
import { collectParseDiagnostics } from "../../src/shared/tree-sitter-diagnostics";

const SYNTAX_SOURCE = "BGforge MLS (syntax)";

/** Wrap a trigger line in the smallest legal block, so only the trigger is under test. */
function trigger(text: string): string {
    return `IF\n\t${text}\nTHEN\n\tRESPONSE #100\n\t\tNoAction()\nEND\n`;
}

beforeAll(async () => {
    await baf.initParser();
});

describe("weidu-baf parse errors", () => {
    it("returns no diagnostics for a clean block", () => {
        const tree = baf.parseWithCache(trigger("Race(Myself,HUMAN)"))!;
        expect(collectParseDiagnostics(tree.rootNode)).toEqual([]);
    });

    // Hyphenated IDS symbols are real (RACE.IDS: KUO-TOA, YUAN-TI, WILL-O-WISP; the
    // extension's own weidu-baf-ids.yml ships them), so flagging one is a false positive.
    it.each(["Race(Myself,KUO-TOA)", "Race(Myself,WILL-O-WISP)", "Range([EVILCUTOFF.0.KUO-TOA],30)"])(
        "accepts a hyphenated IDS name: %s",
        (text) => {
            const tree = baf.parseWithCache(trigger(text))!;
            expect(collectParseDiagnostics(tree.rootNode)).toEqual([]);
        },
    );

    it("still flags genuinely malformed input", () => {
        const tree = baf.parseWithCache(trigger("@@@ !!! ###"))!;
        const diagnostics = collectParseDiagnostics(tree.rootNode);
        expect(diagnostics.length).toBeGreaterThan(0);
        expect(diagnostics[0]!.severity).toBe(DiagnosticSeverity.Error);
        expect(diagnostics[0]!.source).toBe(SYNTAX_SOURCE);
    });
});
