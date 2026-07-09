/**
 * Helpers shared by the dialog source writers/serializers and the id allocators. These were duplicated byte-for-
 * byte across the SSL/TSSL/TD families (each writer is a sibling over a different target syntax); the logic here
 * is family-agnostic - line/indent geometry, `@N` parsing, id seeding, and the SSL-family new-option marker - so
 * it lives once. Family-SPECIFIC markers stay in their own module (e.g. the TD writer's `isNewTDOption` keys on
 * the D-family `sourceRange`, not the SSL-family `callRange`/`stmtRange` that `isNewOption` below reads).
 */

import type { SpliceOp } from "./dialog-splice";
import type { DialogChoice, DialogModel, DialogState } from "./dialog-model";

/** Every state across the model's roots, flattened - for id-keyed diffing and whole-model scans. */
export function allStates(model: DialogModel): DialogState[] {
    return model.roots.flatMap((r) => r.states);
}

/**
 * The numeric id of a bare `@N` display text, or undefined when the text is not a bare ref. THE single `@N`
 * parser for every writer/serializer (they used to each re-implement this regex, two of them with a `NaN`
 * sentinel). A caller that wants a `NaN` sentinel wraps it: `bareMsgId(text) ?? NaN`.
 */
export function bareMsgId(text: string | undefined): number | undefined {
    const m = /^@(\d+)$/.exec((text ?? "").trim());
    return m ? Number(m[1]) : undefined;
}

/** First free `.msg`/`.tra` id: one past the max existing numeric key (or 1 when there are none). */
export function nextIdSeed(existingMessages: Record<string, string>): number {
    const ids = Object.keys(existingMessages)
        .map((k) => Number.parseInt(k, 10))
        .filter((n) => Number.isFinite(n));
    return (ids.length > 0 ? Math.max(...ids) : 0) + 1;
}

/**
 * An SSL-family (SSL / TSSL) new option READY TO SPLICE: no source span (`callRange`/`stmtRange` absent), text
 * already an ALLOCATED bare `@N`, and not `committed`. Distinct from `dialog-ssl-ids.ts`'s pre-allocation
 * `isNewOption` (literal text, before an id is assigned) - this is the post-allocation splicing marker, hence
 * the `Allocated` in the name. `committed` marks an option the host already spliced on a prior save (the webview
 * copy still lacks a callRange - the guard suppresses the re-project that would give it one); excluding it stops
 * a still-pending, already-committed option being re-added (duplicated) every later save. The `stmtRange` check
 * also separates a new option from an EXISTING terminal message (`NMessage`/`GMessage`/`BMessage`): a message
 * carries no `callRange` (no target node) but the parser DID record its `stmtRange`, so without it an existing
 * message would be misread as new and re-appended every structural save.
 */
export function isAllocatedNewOption(c: DialogChoice): boolean {
    return (
        !c.committed && c.callRange === undefined && c.stmtRange === undefined && /^@\d+$/.test((c.text ?? "").trim())
    );
}

/** The leading whitespace of the line containing `offset` - reused as the indent for an inserted statement. */
export function lineIndentAt(text: string, offset: number): string {
    let start = offset;
    while (start > 0 && text[start - 1] !== "\n") start--;
    let i = start;
    while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
    return text.slice(start, i);
}

/** Splice a whole statement out, eating its line's leading indent and trailing newline so no blank line remains. */
export function removeLineSplice(text: string, span: { start: number; end: number }): SpliceOp {
    let start = span.start;
    while (start > 0 && (text[start - 1] === " " || text[start - 1] === "\t")) start--;
    let end = span.end;
    if (text[end] === "\r" && text[end + 1] === "\n") end += 2;
    else if (text[end] === "\n") end += 1;
    return { start, end, replacement: "" };
}
