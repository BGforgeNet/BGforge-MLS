/**
 * TextMate tokenizer for Fallout SSL, running inside the dialog-editor webview.
 *
 * Why TextMate here while WeiDU BAF uses tree-sitter (tokenize.ts): the webview's job is to look like the real
 * editor, and the editor colours every one of these languages through its TextMate grammar - never tree-sitter.
 * For SSL that difference is load-bearing. An SSL argument can be a variable, so the editor isolates a constant
 * by CASING (constant.language via `[A-Z][A-Z0-9]*(_\w+)?`), which a position-based parse cannot reproduce
 * without mislabelling `local_var(x)`'s variable as a constant. Running the grammar itself is parity by
 * construction: the same scopes the editor sees, the same casing, and no synthetic wrapper - TextMate is
 * line-oriented, so it tokenizes a bare condition fragment directly (tree-sitter needed an IF/THEN wrapper
 * because a fragment does not parse from the grammar's root rule).
 *
 * This is the first language on the TextMate path; BAF and the TypeScript-family (TD/TSSL) are planned to move
 * onto it too, at which point tokenize.ts (tree-sitter) retires. See tmp planning notes.
 */

import { INITIAL, Registry, type IGrammar, type IRawGrammar } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import type { HighlightRole, Span } from "./types";

/** A grammar to register, keyed by its TextMate scope name so a grammar's `include: source.X` resolves. */
export interface GrammarSource {
    scopeName: string;
    grammar: IRawGrammar;
}

let grammar: IGrammar | undefined;

let markReady: () => void;
const ready = new Promise<void>((resolve) => {
    markReady = resolve;
});

/**
 * Resolves once the tokenizer can colour. Purely a reactivity trigger for the renderer, exactly like
 * tokenize.ts's `tokenizerReady`: the webview mounts before the grammar is loaded, so a field renders flat and
 * re-renders coloured when this resolves. Never rejects - a failed init leaves it pending and fields stay flat.
 */
export function sslTokenizerReady(): Promise<void> {
    return ready;
}

// loadWASM is process-global and throws if called twice. The webview calls init once; a re-init (only the unit
// suite, and only if it ever inits twice) must not re-load the wasm. The grammar itself is cheap to rebuild.
let wasmLoaded = false;

/**
 * Initialise from the oniguruma wasm BYTES and the parsed grammar objects. Bytes/objects are injected rather
 * than imported here so this module carries no build-time asset loader (only esbuild has one) and stays
 * unit-testable: the webview entry (main.ts) supplies them from bundled imports, the test reads them from disk.
 * Mirrors tokenize.ts's bytes-in design.
 */
export async function initSslTokenizer(
    onigWasm: Uint8Array,
    grammars: GrammarSource[],
    rootScope = "source.fallout-ssl",
): Promise<void> {
    if (!wasmLoaded) {
        await loadWASM(onigWasm);
        wasmLoaded = true;
    }
    const byScope = new Map(grammars.map((g) => [g.scopeName, g.grammar]));
    const registry = new Registry({
        onigLib: Promise.resolve({
            createOnigScanner: (patterns: string[]) => new OnigScanner(patterns),
            createOnigString: (text: string) => new OnigString(text),
        }),
        loadGrammar: async (scopeName) => byScope.get(scopeName) ?? null,
    });
    grammar = (await registry.loadGrammar(rootScope)) ?? undefined;
    markReady();
}

/**
 * Map a TextMate scope stack to a highlight role, deepest (most specific) scope first - a theme resolves a
 * token by its longest matching scope, so the deepest scope is the one that decides the colour. Keyed to the
 * scope FAMILIES the SSL grammar emits (syntaxes/fallout-ssl.tmLanguage.yml); anything unmatched stays plain.
 *
 * Two ordering points are load-bearing:
 *   - constant.numeric is tested before the generic constant.* so a number reads as a number, not a constant.
 *   - operators and control keywords BOTH carry keyword.control in this grammar, so both land on `keyword`.
 *     That matches the editor (monokai colours them alike) rather than splitting a distinction the grammar
 *     does not make - the BAF tree-sitter query separates them because tree-sitter's node types do; TextMate's
 *     scopes here do not, and parity means following the scopes.
 */
function scopeToRole(scopes: readonly string[]): HighlightRole | undefined {
    for (let i = scopes.length - 1; i >= 0; i -= 1) {
        const scope = scopes[i]!;
        if (scope.startsWith("comment")) return "comment";
        if (scope.startsWith("string")) return "string";
        if (scope.startsWith("constant.numeric")) return "number";
        if (scope.startsWith("constant")) return "constant";
        if (scope.startsWith("keyword")) return "keyword";
        if (scope.startsWith("entity.name.function")) return "trigger";
        if (scope.startsWith("support.function")) return "action";
        if (scope.startsWith("variable")) return "variable";
        if (scope.startsWith("punctuation")) return "punctuation";
    }
    return undefined;
}

/**
 * Tokenize one field's condition. Spans are returned in the text's own coordinates.
 *
 * Synchronous and total: never throws. An uninitialised tokenizer returns [], and the caller renders flat
 * text - degraded and visible, never blank. A condition is normally one line, but tokenizing line by line
 * (threading the rule stack) keeps a multi-line value aligned rather than assuming a single line.
 *
 * TextMate partitions each line into contiguous, non-overlapping tokens, so the spans satisfy toParts'
 * non-overlap contract by construction; whitespace-only and unmapped tokens are dropped, leaving gaps that
 * toParts fills as plain text.
 */
export function tokenizeSsl(text: string): Span[] {
    if (!grammar) {
        return [];
    }
    const spans: Span[] = [];
    let offset = 0;
    let stack = INITIAL;
    for (const line of text.split("\n")) {
        let result;
        try {
            result = grammar.tokenizeLine(line, stack);
        } catch {
            return spans;
        }
        stack = result.ruleStack;
        for (const token of result.tokens) {
            const role = scopeToRole(token.scopes);
            if (!role) {
                continue;
            }
            const start = offset + token.startIndex;
            const end = offset + token.endIndex;
            if (text.slice(start, end).trim() === "") {
                continue;
            }
            spans.push({ start, end, role });
        }
        // + 1 for the "\n" that split() removed, so the next line's offsets stay in whole-text coordinates.
        offset += line.length + 1;
    }
    return spans;
}
