/**
 * TextMate tokenizer for the dialog-editor webview - the single highlighting engine for every condition/action
 * field, across all four dialog source languages.
 *
 * Why TextMate (and not tree-sitter, which this replaced): the webview's job is to look like the real editor,
 * and the editor colours every one of these languages through a TextMate-family grammar. Running the grammars
 * themselves is parity by construction - the same scopes, the same casing, no synthetic wrapper (TextMate is
 * line-oriented, so a bare condition fragment tokenizes directly; tree-sitter needed an IF/THEN wrapper because
 * a fragment does not parse from a grammar's root rule). It also covers the TypeScript-family languages (TD and
 * TSSL, whose conditions are TypeScript source), which tree-sitter could not: there is no TD/TSSL tree-sitter
 * grammar, so a single tree-sitter engine was structurally incapable of colouring half the languages.
 *
 * Three grammars are registered, keyed by a short lang tag:
 *   - "baf": WeiDU BAF triggers/actions (D conditions, TD actions). syntaxes/weidu-baf.tmLanguage.json.
 *   - "ssl": Fallout SSL (SSL conditions). syntaxes/fallout-ssl.tmLanguage.json (+ its docstring include).
 *   - "ts":  a minimal TypeScript-expression grammar (TD/TSSL conditions). syntaxes/dialog-tsexpr.tmLanguage.json.
 * The caller (Inspector) picks the tag from the field's SOURCE language, not the render family - a TSSL
 * condition is TypeScript even though it renders in the SSL-family editor.
 */

import { INITIAL, Registry, type IGrammar, type IRawGrammar } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import type { HighlightRole, Span } from "./types";

/** The three condition/action grammars, tagged by the tokenizer's public lang id. */
export type TmLang = "baf" | "ssl" | "ts";

/** A grammar to register, keyed by its TextMate scope name so a grammar's `include: source.X` resolves. */
export interface GrammarSource {
    scopeName: string;
    grammar: IRawGrammar;
}

const grammars = new Map<TmLang, IGrammar>();

let markReady: () => void;
const ready = new Promise<void>((resolve) => {
    markReady = resolve;
});

/**
 * Resolves once the tokenizer can colour. Purely a reactivity trigger for the renderer: the webview mounts
 * before the grammars are loaded, so a field renders flat and re-renders coloured when this resolves. Never
 * rejects - a failed init leaves it pending and fields stay flat.
 */
export function textmateReady(): Promise<void> {
    return ready;
}

// loadWASM is process-global and throws if called twice. The webview calls init once; a re-init (only the unit
// suite, and only if it ever inits twice) must not re-load the wasm. The grammars themselves are cheap to rebuild.
let wasmLoaded = false;

/**
 * Initialise from the oniguruma wasm BYTES and the parsed grammar objects. Bytes/objects are injected rather
 * than imported here so this module carries no build-time asset loader (only esbuild has one) and stays
 * unit-testable: the webview entry (main.ts) supplies them from bundled imports, the test reads them from disk.
 *
 * `roots` maps each lang tag to the scope name of its root grammar; every grammar an include chain can reach
 * (e.g. the SSL grammar's docstring include) must be present in `sources` so the shared registry resolves it.
 */
export async function initTextmate(
    onigWasm: Uint8Array,
    sources: GrammarSource[],
    roots: Record<TmLang, string>,
): Promise<void> {
    if (!wasmLoaded) {
        await loadWASM(onigWasm);
        wasmLoaded = true;
    }
    const byScope = new Map(sources.map((s) => [s.scopeName, s.grammar]));
    const registry = new Registry({
        onigLib: Promise.resolve({
            createOnigScanner: (patterns: string[]) => new OnigScanner(patterns),
            createOnigString: (text: string) => new OnigString(text),
        }),
        loadGrammar: async (scopeName) => byScope.get(scopeName) ?? null,
    });
    // The root grammars load independently against the shared registry (each resolves its own include chain
    // through byScope), so load them concurrently rather than one after another.
    await Promise.all(
        (Object.entries(roots) as [TmLang, string][]).map(async ([lang, scopeName]) => {
            const g = await registry.loadGrammar(scopeName);
            if (g) {
                grammars.set(lang, g);
            }
        }),
    );
    markReady();
}

/**
 * Map a TextMate scope stack to a highlight role, deepest (most specific) scope first - a theme resolves a
 * token by its longest matching scope, so the deepest scope is the one that decides the colour. Keyed to the
 * standard scope FAMILIES all three grammars emit; anything unmatched stays plain (a bare variable in a
 * condition, matching how each grammar leaves a variable uncoloured).
 *
 * Two ordering points are load-bearing:
 *   - constant.numeric is tested before the generic constant.* so a number reads as a number, not a constant.
 *   - operators and control keywords BOTH carry a keyword.* scope in these grammars, so both land on `keyword`.
 *     That matches the editor (monokai colours them alike) rather than splitting a distinction the grammars do
 *     not make - parity means following the scopes.
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
 * Tokenize one field's fragment in the grammar for `lang`. Spans are returned in the text's own coordinates.
 *
 * Synchronous and total: never throws. An uninitialised tokenizer (or an unknown lang) returns [], and the
 * caller renders flat text - degraded and visible, never blank. A condition is normally one line, but tokenizing
 * line by line (threading the rule stack) keeps a multi-line value aligned rather than assuming a single line.
 *
 * TextMate partitions each line into contiguous, non-overlapping tokens, so the spans satisfy toParts'
 * non-overlap contract by construction; whitespace-only and unmapped tokens are dropped, leaving gaps that
 * toParts fills as plain text.
 */
export function tokenize(lang: TmLang, text: string): Span[] {
    const grammar = grammars.get(lang);
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
