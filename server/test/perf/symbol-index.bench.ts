/**
 * Measures query({}) and searchWorkspaceSymbols over a 500-file x 20-symbol
 * seeded workspace. query({}) is called per keystroke from completion handlers;
 * searchWorkspaceSymbols from Ctrl+T.
 */
import { bench, describe, beforeAll } from "vitest";
import { MarkupKind } from "vscode-languageserver/node";
import { Symbols } from "../../src/core/symbol-index";
import { ScopeLevel, SourceType, SymbolKind, type IndexedSymbol } from "../../src/core/symbol";
import type { NormalizedUri } from "../../src/core/normalized-uri";

// ComponentSymbol has no discriminator-specific fields beyond BaseSymbol's
// completion/hover — the lightest shape for seeding the index in a bench.
function makeSym(name: string, uri: NormalizedUri): IndexedSymbol {
    return {
        name,
        kind: SymbolKind.Component,
        scope: { level: ScopeLevel.Workspace },
        source: { type: SourceType.Workspace, uri, displayPath: uri },
        location: {
            uri,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        },
        completion: { label: name },
        hover: { contents: { kind: MarkupKind.Markdown, value: "" } },
    };
}

const symbols = new Symbols();

// Observe results externally so V8 can't dead-code-eliminate the calls.
// Each bench body does 100 iterations to lift per-call work comfortably above
// the measurement floor.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- exported-as-side-effect to defeat DCE
let sink = 0;

describe("symbol-index hot paths", () => {
    beforeAll(() => {
        for (let f = 0; f < 500; f++) {
            const uri = `file:///mod/f${f}.tp2` as NormalizedUri;
            const fileSyms: IndexedSymbol[] = [];
            for (let i = 0; i < 20; i++) fileSyms.push(makeSym(`fn_${f}_${i}`, uri));
            symbols.updateFile(uri, fileSyms);
        }
    });

    bench("query({}) — no filters (x100)", () => {
        for (let i = 0; i < 100; i++) sink += symbols.query({}).length;
    });

    bench("query({ prefix: 'fn_100' }) (x100)", () => {
        for (let i = 0; i < 100; i++) sink += symbols.query({ prefix: "fn_100" }).length;
    });

    bench("searchWorkspaceSymbols('fn_100') (x100)", () => {
        for (let i = 0; i < 100; i++) sink += symbols.searchWorkspaceSymbols("fn_100").length;
    });
});
