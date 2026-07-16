/**
 * Tree-sitter tokenizer for WeiDU BAF, running inside the dialog-editor webview.
 *
 * Why tree-sitter identifies constants by POSITION here while the TextMate grammar
 * (syntaxes/weidu-baf.tmLanguage.yml) matches them by CASING: tree-sitter has a parse tree, so it can ask
 * whether an identifier sits in a call's `args:` field - which also covers the CamelCase OBJECT.IDS entries a
 * casing rule cannot reach. TextMate has only regex and cannot ask that question. Same colours, different
 * mechanisms - a capability difference between the engines, not drift.
 */

import { Language, Parser, Query } from "web-tree-sitter";

export type HighlightRole =
    | "keyword"
    | "trigger"
    | "action"
    | "constant"
    | "string"
    | "number"
    | "comment"
    | "punctuation";

export interface Span {
    start: number;
    end: number;
    role: HighlightRole;
}

/** Which kind of BAF fragment a field holds. Decides the synthetic context it is parsed in. */
export type BafFragmentKind = "condition" | "action";

/**
 * The inspector's fields hold BARE fragments - `General(Myself,NEUTRAL)`, `SetGlobal("x","GLOBAL",1)` - not
 * whole scripts. The BAF grammar has no start rule for either: parsed alone, `General(Myself,NEUTRAL)` yields
 * `(ERROR (UNEXPECTED 'G') ...)` and captures only its brackets and commas, so every name in the field would
 * render uncoloured. Parsing each fragment inside a minimal synthetic block restores the structure the query
 * matches on, and the wrapper's own captures are discarded by offset before anything is painted.
 *
 * Both wrappers are chosen to parse with NO error node, so the query matches against a clean tree rather than
 * relying on error recovery. The condition wrapper needs an action body: `RESPONSE #100` with nothing after it
 * does not parse.
 */
const WRAPPERS: Readonly<Record<BafFragmentKind, { prefix: string; suffix: string }>> = {
    condition: { prefix: "IF ", suffix: " THEN\nRESPONSE #100\nEscapeArea()\nEND" },
    action: { prefix: "IF True() THEN\nRESPONSE #100\n", suffix: "\nEND" },
};

/**
 * tree-sitter capture name -> role. A capture with no entry here is left uncoloured.
 *
 * Every name below is a capture that grammars/weidu-baf/queries/highlights.scm actually emits; the two sides
 * are checked against each other by client/test/dialog-highlight-tokenize.test.ts, which tokenizes with the
 * real query rather than a stub.
 */
const CAPTURE_ROLES: Readonly<Record<string, HighlightRole>> = {
    keyword: "keyword",
    function: "trigger",
    "function.builtin": "action",
    constant: "constant",
    variable: "constant",
    string: "string",
    "string.special": "string",
    number: "number",
    comment: "comment",
    operator: "punctuation",
    "punctuation.bracket": "punctuation",
    "punctuation.delimiter": "punctuation",
    "punctuation.special": "punctuation",
};

let parser: Parser | undefined;
let query: Query | undefined;

/**
 * Initialise from wasm BYTES and the query source.
 *
 * Bytes rather than URLs mirrors the repo's Node-side idiom (shared/parsers/parser-factory.ts:28-29 does
 * `Parser.init({ wasmBinary })` from a readFileSync buffer) and keeps URL resolution out of Emscripten's
 * hands - the webview cannot resolve relative paths under the host CSP, so `locateFile` would be the wrong
 * shape. shared/parsers/ cannot be reused despite doing the same job: it is Node-bound (`fs.readFileSync`,
 * `path.join(__dirname, ...)`).
 *
 * The query source is injected rather than imported so this module stays free of a build-time `.scm` text
 * loader, which only esbuild is configured for; the webview entry point supplies it, and tests supply the
 * same file read from disk.
 */
export async function initTokenizerFromBytes(
    runtimeWasm: Uint8Array,
    grammarWasm: Uint8Array,
    highlightsScm: string,
): Promise<void> {
    await Parser.init({ wasmBinary: runtimeWasm });
    const language = await Language.load(grammarWasm);
    parser = new Parser();
    parser.setLanguage(language);
    query = new Query(language, highlightsScm);
}

/**
 * Called ONCE at webview startup. Both URIs are produced host-side by webview.asWebviewUri(): the webview
 * cannot resolve relative paths under the host's CSP, so it never builds its own.
 */
export async function initTokenizer(
    runtimeWasmUri: string,
    grammarWasmUri: string,
    highlightsScm: string,
): Promise<void> {
    const [runtimeWasm, grammarWasm] = await Promise.all([
        fetch(runtimeWasmUri).then((r) => r.arrayBuffer()),
        fetch(grammarWasmUri).then((r) => r.arrayBuffer()),
    ]);
    await initTokenizerFromBytes(new Uint8Array(runtimeWasm), new Uint8Array(grammarWasm), highlightsScm);
}

/**
 * Tokenize one field's fragment. Spans are returned in the FRAGMENT's own coordinates, so the caller never
 * sees the synthetic wrapper.
 *
 * Synchronous and total: never throws. An uninitialised tokenizer returns [], and the caller renders flat
 * text - degraded and visible, never blank. Half-typed input is NOT an error case: tree-sitter is
 * error-tolerant and returns a partial tree, so an incomplete call still colours what it recognises. Until
 * its closing paren is typed the call's own names sit under an ERROR node and stay uncoloured, then snap into
 * colour when it closes - partial, never wrong.
 */
export function tokenizeBaf(text: string, kind: BafFragmentKind): Span[] {
    if (!parser || !query) {
        return [];
    }
    const { prefix, suffix } = WRAPPERS[kind];
    let tree;
    try {
        tree = parser.parse(prefix + text + suffix);
    } catch {
        return [];
    }
    if (!tree) {
        return [];
    }
    try {
        const fragmentStart = prefix.length;
        const fragmentEnd = fragmentStart + text.length;
        const spans: Span[] = [];
        for (const capture of query.captures(tree.rootNode)) {
            const role = CAPTURE_ROLES[capture.name];
            if (!role) {
                continue;
            }
            const { startIndex, endIndex } = capture.node;
            // Discard the wrapper's own captures: keep only spans lying wholly inside the fragment, then
            // rebase them so the caller addresses its own text.
            if (startIndex < fragmentStart || endIndex > fragmentEnd) {
                continue;
            }
            spans.push({ start: startIndex - fragmentStart, end: endIndex - fragmentStart, role });
        }
        // The renderer walks the spans in order, so sort them. web-tree-sitter does not document an ordering
        // across a query's patterns, and every capture here is a distinct leaf token: highlights.scm captures
        // each object-specifier component and each point coordinate individually rather than capturing the
        // bracket as one node, so no two spans cover the same character and there is nothing to arbitrate.
        // A whole-node capture would reintroduce overlap, and this is where a resolver would belong.
        spans.sort((a, b) => a.start - b.start);
        return spans;
    } catch {
        return [];
    } finally {
        // web-tree-sitter allocates the tree on the WASM heap and does not free it on GC. This runs per
        // keystroke, so a missing delete() leaks the heap until the webview is closed.
        tree.delete();
    }
}
