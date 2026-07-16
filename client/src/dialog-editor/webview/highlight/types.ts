/**
 * Shared vocabulary for the dialog-editor's field highlighters. Two engines produce these same roles from
 * different sources - a tree-sitter parse tree for WeiDU BAF (tokenize.ts) and a TextMate grammar for Fallout
 * SSL (textmate.ts) - so the overlay component (CodeField.svelte) paints one role set regardless of language.
 *
 * The role set is deliberately small and keyed to TextMate scope FAMILIES, which the two languages share:
 * entity.name.function -> `trigger`, support.function -> `action`, constant.* -> `constant`/`number`, and so
 * on. That is why the same palette colours both grammars without a per-language colour table.
 */

export type HighlightRole =
    | "keyword"
    | "trigger"
    | "action"
    | "constant"
    | "variable"
    | "string"
    | "number"
    | "comment"
    | "punctuation";

export interface Span {
    start: number;
    end: number;
    role: HighlightRole;
}

/** One run of field text, with the role to paint it (absent = paint it as plain text). */
export interface Part {
    text: string;
    role?: HighlightRole;
}

/**
 * Cut `text` into consecutive runs covering it exactly, so a renderer can emit one element per run and the
 * concatenation still reads as the original string - a character silently dropped or doubled here would
 * misalign a text overlay against the input it sits under.
 *
 * Relies on the tokenizer's contract that spans are sorted, in-bounds, and non-overlapping. Both tokenizers
 * emit leaf-token spans only, so there is nothing to arbitrate here; a whole-node capture would break that,
 * and the resolver would belong in the tokenizer (where the contract is stated), not here.
 */
export function toParts(text: string, spans: Span[]): Part[] {
    const parts: Part[] = [];
    let at = 0;
    for (const { start, end, role } of spans) {
        if (start > at) {
            parts.push({ text: text.slice(at, start) });
        }
        parts.push({ text: text.slice(start, end), role });
        at = end;
    }
    if (at < text.length) {
        parts.push({ text: text.slice(at) });
    }
    return parts;
}
