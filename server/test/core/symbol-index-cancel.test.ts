/**
 * Cancellation-responsiveness test for Symbols.searchWorkspaceSymbols.
 *
 * Validates that a cancelled workspace/symbol request yields within the
 * configured CANCEL_CHECK_INTERVAL window rather than scanning the entire
 * index. Prior to the tightening, the check fired every 64 iterations; the
 * window is now 16.
 */

import { type CancellationToken, CompletionItemKind } from "vscode-languageserver/node";
import { describe, expect, it } from "vitest";
import { Symbols } from "../../src/core/symbol-index";
import { type Symbol, ScopeLevel, SourceType, SymbolKind } from "../../src/core/symbol";

function makeUri(n: number): string {
    return `file:///cancel-test-${n}.ssl`;
}

function makeSymbol(name: string, uri: string): Symbol {
    return {
        name,
        kind: SymbolKind.Variable,
        location: {
            uri,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: name.length } },
        },
        scope: { level: ScopeLevel.File },
        source: { type: SourceType.Document, uri },
        completion: { label: name, kind: CompletionItemKind.Variable },
        hover: { contents: { kind: "markdown", value: name } },
    };
}

/** CancellationToken stub that flips to cancelled after the Nth read. */
function tokenCancelledAfter(n: number): CancellationToken {
    let reads = 0;
    return {
        get isCancellationRequested() {
            reads += 1;
            return reads > n;
        },
        onCancellationRequested: () => ({ dispose: () => undefined }),
    };
}

describe("Symbols.searchWorkspaceSymbols — cancellation responsiveness", () => {
    it("returns within CANCEL_CHECK_INTERVAL (16) of cancellation on a large index", () => {
        const index = new Symbols({ maxFiles: 1000 });
        for (let i = 1; i <= 500; i++) {
            const uri = makeUri(i) as Parameters<typeof index.updateFile>[0];
            index.updateFile(uri, [makeSymbol(`sym${i}`, uri)]);
        }

        // Flip cancellation after the first isCancellationRequested read at loop entry,
        // so the inner-loop check fires on the next 16-step boundary.
        const token = tokenCancelledAfter(1);
        const results = index.searchWorkspaceSymbols("", 500, token);

        // After the entry check returns [], a yield here is []. When cancellation flips
        // mid-loop on the interval boundary, the loop exits within 16 pushed results of
        // detection. Give a small safety margin (2×) for any one-off iteration work.
        expect(results.length).toBeLessThanOrEqual(32);
    });
});
