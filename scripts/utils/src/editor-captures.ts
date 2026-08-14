/**
 * Per-editor tree-sitter capture support, and the mappings that make one canonical
 * `highlights.scm` usable in each.
 *
 * The canonical queries under `grammars/<g>/queries/` are written to Neovim conventions. Helix and Zed
 * name several captures differently and style a different subset, so a file that highlights fully in
 * Neovim highlights thinly - or, per token, not at all - elsewhere. `generate-editor-queries.ts`
 * rewrites the canonical file per editor through CAPTURE_MAPPINGS, and `editor-captures.test.ts` asserts
 * every capture it emits is one the target actually styles.
 *
 * The three supported-capture sets are VENDORED rather than derived at build time: they are facts about
 * released editors, so fetching them during a build would make the output depend on the day it ran.
 * `scripts/utils/src/check-editor-captures.ts` re-derives them from the sources named below and reports drift.
 */

export type Editor = "neovim" | "helix" | "zed";

/**
 * Source: neovim `runtime/doc/treesitter.txt`, the `@`-prefixed names under
 * treesitter-highlight-groups. Vendored 2026-08-06 from the master doc.
 */
export const NEOVIM_CAPTURES: readonly string[] = [
    "attribute",
    "attribute.builtin",
    "boolean",
    "character",
    "character.special",
    "comment",
    "comment.documentation",
    "comment.error",
    "comment.note",
    "comment.todo",
    "comment.warning",
    "constant",
    "constant.builtin",
    "constant.macro",
    "constructor",
    "diff.delta",
    "diff.minus",
    "diff.plus",
    "function",
    "function.builtin",
    "function.call",
    "function.macro",
    "function.method",
    "function.method.call",
    "keyword",
    "keyword.conditional",
    "keyword.conditional.ternary",
    "keyword.coroutine",
    "keyword.debug",
    "keyword.directive",
    "keyword.directive.define",
    "keyword.exception",
    "keyword.function",
    "keyword.import",
    "keyword.modifier",
    "keyword.operator",
    "keyword.repeat",
    "keyword.return",
    "keyword.type",
    "label",
    "markup.heading",
    "markup.heading.1",
    "markup.heading.2",
    "markup.heading.3",
    "markup.heading.4",
    "markup.heading.5",
    "markup.heading.6",
    "markup.italic",
    "markup.link",
    "markup.link.label",
    "markup.link.url",
    "markup.list",
    "markup.list.checked",
    "markup.list.unchecked",
    "markup.math",
    "markup.quote",
    "markup.raw",
    "markup.raw.block",
    "markup.strikethrough",
    "markup.strong",
    "markup.underline",
    "module",
    "module.builtin",
    "number",
    "number.float",
    "operator",
    "property",
    "punctuation.bracket",
    "punctuation.delimiter",
    "punctuation.special",
    "string",
    "string.documentation",
    "string.escape",
    "string.regexp",
    "string.special",
    "string.special.path",
    "string.special.symbol",
    "string.special.url",
    "tag",
    "tag.attribute",
    "tag.builtin",
    "tag.delimiter",
    "type",
    "type.builtin",
    "type.definition",
    "variable",
    "variable.builtin",
    "variable.member",
    "variable.parameter",
    "variable.parameter.builtin",
];

/**
 * Source: helix `book/src/themes.md`, the nested scope list flattened to dotted names.
 * Vendored 2026-08-06.
 */
export const HELIX_SCOPES: readonly string[] = [
    "attribute",
    "comment",
    "comment.block",
    "comment.block.documentation",
    "comment.line",
    "comment.line.documentation",
    "comment.unused",
    "constant",
    "constant.builtin",
    "constant.builtin.boolean",
    "constant.character",
    "constant.character.escape",
    "constant.numeric",
    "constant.numeric.float",
    "constant.numeric.integer",
    "constructor",
    "diff",
    "diff.delta",
    "diff.delta.conflict",
    "diff.delta.gutter",
    "diff.delta.moved",
    "diff.minus",
    "diff.minus.gutter",
    "diff.plus",
    "diff.plus.gutter",
    "embedded",
    "function",
    "function.builtin",
    "function.macro",
    "function.method",
    "function.method.private",
    "function.method.public",
    "function.public",
    "function.special",
    "keyword",
    "keyword.control",
    "keyword.control.conditional",
    "keyword.control.exception",
    "keyword.control.import",
    "keyword.control.repeat",
    "keyword.control.return",
    "keyword.directive",
    "keyword.function",
    "keyword.operator",
    "keyword.storage",
    "keyword.storage.modifier",
    "keyword.storage.type",
    "label",
    "markup",
    "markup.bold",
    "markup.heading",
    "markup.heading.1",
    "markup.heading.completion",
    "markup.heading.hover",
    "markup.heading.marker",
    "markup.italic",
    "markup.link",
    "markup.link.label",
    "markup.link.text",
    "markup.link.url",
    "markup.list",
    "markup.list.checked",
    "markup.list.numbered",
    "markup.list.unchecked",
    "markup.list.unnumbered",
    "markup.normal",
    "markup.normal.completion",
    "markup.normal.hover",
    "markup.quote",
    "markup.raw",
    "markup.raw.block",
    "markup.raw.inline",
    "markup.raw.inline.completion",
    "markup.raw.inline.hover",
    "markup.strikethrough",
    "namespace",
    "operator",
    "punctuation",
    "punctuation.bracket",
    "punctuation.delimiter",
    "punctuation.special",
    "special",
    "string",
    "string.regexp",
    "string.special",
    "string.special.path",
    "string.special.symbol",
    "string.special.url",
    "tag",
    "tag.builtin",
    "type",
    "type.builtin",
    "type.enum",
    "type.enum.variant",
    "type.parameter",
    "variable",
    "variable.builtin",
    "variable.builtin.mutable",
    "variable.mutable",
    "variable.other",
    "variable.other.member",
    "variable.other.member.private",
    "variable.parameter",
    "variable.parameter.mutable",
];

/**
 * Source: the theme JSON embedded in the `zed-editor` binary (1.14.2), keys that carry a `color`.
 * Vendored 2026-08-06.
 *
 * The binary is authoritative here and the published capture table is not: that table omits
 * `function.builtin`, which every bundled theme styles, and reading it instead put our commonest
 * capture in the unsupported column.
 */
export const ZED_THEME_KEYS: readonly string[] = [
    "attribute",
    "boolean",
    "comment",
    "comment.doc",
    "constant",
    "constructor",
    "diff.minus",
    "diff.plus",
    "embedded",
    "emphasis",
    "emphasis.strong",
    "enum",
    "function",
    "function.builtin",
    "hint",
    "keyword",
    "label",
    "link_text",
    "link_uri",
    "namespace",
    "number",
    "operator",
    "predictive",
    "preproc",
    "primary",
    "property",
    "punctuation",
    "punctuation.bracket",
    "punctuation.delimiter",
    "punctuation.list_marker",
    "punctuation.markup",
    "punctuation.special",
    "selector",
    "selector.pseudo",
    "string",
    "string.escape",
    "string.regex",
    "string.special",
    "string.special.symbol",
    "tag",
    "text.literal",
    "title",
    "type",
    "variable",
    "variable.parameter",
    "variable.special",
    "variant",
];

const SUPPORTED: Record<Editor, ReadonlySet<string>> = {
    neovim: new Set(NEOVIM_CAPTURES),
    helix: new Set(HELIX_SCOPES),
    zed: new Set(ZED_THEME_KEYS),
};

/**
 * Whether an unlisted dotted capture inherits its parent's style. All three do, which is why the mapping
 * tables below are as small as they are - an editor only needs an entry where its NAME for a concept
 * differs, not merely where it lacks the specific one.
 *
 * Neovim and Helix document theirs ("the longest matching theme key"). Zed's is not in its docs, which
 * describe only the multi-capture form and thereby suggest there is nothing else; the source settles it -
 * `SyntaxTheme::highlight_id` (crates/syntax_theme) ranges the theme's keys from the capture's first
 * segment to its full name and takes the longest that is a dotted prefix.
 */
const PREFIX_FALLBACK: Record<Editor, boolean> = { neovim: true, helix: true, zed: true };

/**
 * Canonical capture -> the target's own name for it. Only entries that change something are listed:
 * where an editor prefix-falls-back to a style that is already right, the canonical name is left alone.
 */
export const CAPTURE_MAPPINGS: Record<Editor, Readonly<Record<string, string>>> = {
    neovim: {},
    // Helix follows Sublime/TextMate naming. `number` is the one that MUST be mapped - Helix has no
    // `number` root at all, so ours falls back to nothing and renders as plain text (verified by
    // rendering: numbers take the numeric colour with this mapping and the plain-text colour without).
    // The rest are fidelity: unmapped they collapse onto plain `keyword`, and 54 of the 172 themes
    // Helix ships style `keyword.control` apart from `keyword`.
    helix: {
        number: "constant.numeric",
        "keyword.conditional": "keyword.control.conditional",
        "keyword.conditional.ternary": "keyword.control.conditional",
        "keyword.repeat": "keyword.control.repeat",
        "keyword.return": "keyword.control.return",
        "keyword.import": "keyword.control.import",
        "keyword.modifier": "keyword.storage.modifier",
        "keyword.type": "keyword.storage.type",
        "keyword.directive.define": "keyword.directive",
        character: "constant.character",
    },
    // Zed resolves every other capture we emit on its own: the first segment (keyword, function,
    // constant, variable, ...) is a key its themes define, so its prefix fallback finds the specific
    // names. Flattening those here would be worse than doing nothing - it would discard the specific name
    // for the themes that DO define it. `character` is the exception: Zed has no such root, so it needs
    // the name Zed and Helix share.
    zed: { character: "constant.character" },
};

/** Does `editor` style `capture`, directly or through its prefix fallback? */
export function supports(editor: Editor, capture: string): boolean {
    const set = SUPPORTED[editor];
    if (set.has(capture)) return true;
    if (!PREFIX_FALLBACK[editor]) return false;
    const parts = capture.split(".");
    for (let i = parts.length - 1; i > 0; i--) {
        if (set.has(parts.slice(0, i).join("."))) return true;
    }
    return false;
}

/** The name `editor` should see for a canonical capture. */
export function mapCapture(editor: Editor, capture: string): string {
    return CAPTURE_MAPPINGS[editor][capture] ?? capture;
}

/** Every `@capture` a query text uses, ignoring comment lines (which document the mapping in prose). */
export function capturesOf(queryText: string): string[] {
    const found = new Set<string>();
    for (const line of queryText.split("\n")) {
        if (line.trimStart().startsWith(";")) continue;
        for (const m of line.matchAll(/@([a-zA-Z_][a-zA-Z0-9_.]*)/g)) {
            const name = m[1];
            if (name !== undefined) found.add(name);
        }
    }
    return [...found].sort();
}

/**
 * Rewrite a canonical query for `editor`. Comment lines are left alone so the header notes keep
 * describing the canonical names; our queries carry no predicates, so every `@name` on a code line is
 * a highlight capture and can be rewritten without parsing the query.
 */
export function mapQuery(editor: Editor, queryText: string): string {
    return queryText
        .split("\n")
        .map((line) =>
            line.trimStart().startsWith(";")
                ? line
                : line.replaceAll(/@([a-zA-Z_][a-zA-Z0-9_.]*)/g, (_, c: string) => `@${mapCapture(editor, c)}`),
        )
        .join("\n");
}
