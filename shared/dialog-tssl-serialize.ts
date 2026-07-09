/**
 * TSSL source serializer for whole new nodes. Mirrors `dialog-ssl-serialize.ts` `serializeSSLProcedure`, but
 * emits the TypeScript `function NodeNNN() { ... }` wrapper instead of SSL's `procedure ... begin ... end`.
 * The statement bodies (Reply / NOption / NMessage) are byte-identical to SSL, so the option lines reuse
 * `serializeSSLOption` unchanged - only the wrapper differs. Used by the add-node writer in dialog-tssl-edit.ts.
 */

import { bareMsgId } from "./dialog-edit-common";
import { serializeCond, serializeSSLOption } from "./dialog-ssl-serialize";
import type { DialogChoice, DialogState } from "./dialog-model";

/**
 * Wrap a single option in a TS-brace conditional gate - `if (<cond>) { <NOption...>; }` - the TSSL counterpart of
 * `serializeSSLConditionalOption` (`if <cond> then <NOption...>`). The shared nodeOps engine calls this when a
 * condition is ADDED to a flat TSSL option (`applyTSSLDialogEdits` passes it as the wrap serializer); without it
 * the wrap was skipped and a typed condition was silently dropped on save. `cond` is normalized to one paren layer
 * via the shared `serializeCond`; the option line reuses `serializeSSLOption` (NOption/GOption syntax is identical
 * across the fallout-ssl family - only the block delimiters differ). The signature matches
 * `serializeSSLConditionalOption` so nodeOps can take either as its conditional-option serializer.
 */
export function serializeTSSLConditionalOption(
    choice: DialogChoice,
    msgId: number,
    cond: string,
    indent: string,
): string {
    return `if ${serializeCond(cond)} {\n${indent}    ${serializeSSLOption(choice, msgId)}\n${indent}}`;
}

/**
 * Emit a NEW `if`/`else` bundle branch block in TS syntax - `if (<cond>) {` / `else {`, body indented one
 * step, closing `}` at column `indent`. The TS counterpart of `serializeSSLBranch` (`if <cond> then begin ...
 * end`); the option/reply lines are byte-identical to SSL (shared `serializeSSLOption`), only the block
 * delimiters differ. `cond` is stored paren-free (the TSSL `conditionRange` convention), so the parens are added
 * here. Signature matches `serializeSSLBranch` so `branchStructureOps` can take either as its branch serializer.
 */
export function serializeTSSLBranch(
    kind: "if" | "else",
    cond: string | undefined,
    replyMsgIds: number[],
    options: { choice: DialogChoice; msgId: number }[],
    indent: string,
): string {
    const header = kind === "if" ? `if (${cond}) {` : `else {`;
    const innerIndent = `${indent}    `;
    const lines: string[] = [];
    for (const id of replyMsgIds) lines.push(`${innerIndent}Reply(${id});`);
    for (const { choice, msgId } of options) lines.push(`${innerIndent}${serializeSSLOption(choice, msgId)}`);
    return `${header}\n${lines.join("\n")}${lines.length > 0 ? "\n" : ""}${indent}}`;
}

/**
 * Emit a reserved support node as a TSSL `function <id>() { }`. The fallout-ssl family reserves Node999 (exit)
 * and Node998 (combat) as conversation terminals; when an edited option retargets to one the source does not yet
 * declare, the writer emits this stub so the reference resolves instead of dangling on transpile. Unlike SSL's
 * `serializeSupportProcedure` (which emits Node998's default set-hostile combat body), the TSSL stub is emitted
 * EMPTY: the SSL combat body's macro form has no verified TSSL spelling, so the body is left to the modder rather
 * than guessing one that may transpile wrong. Node999 is empty in SSL too, so the common Exit terminal matches.
 * Signature and role mirror `serializeSupportProcedure` so the shared write-back engine can take either.
 */
export function serializeTSSLSupportProcedure(id: string): string {
    return `function ${id}() {\n}`;
}

/**
 * Serialize a new TSSL node as a `function <id>() { ... }` block. The NPC line becomes `Reply(<n>);` when the
 * node carries a resolvable `@N`; each option is serialized by the shared SSL option serializer (a node target
 * -> `NOption(...)`, a terminal -> `NMessage(...)`). Body lines are indented by `indent`; the caller owns the
 * surrounding whitespace (the insertion splice adds the trailing blank line before `talk_p_proc`).
 */
export function serializeTSSLProcedure(state: DialogState, indent = "    "): string {
    const lines: string[] = [];
    const replyId = bareMsgId(state.text);
    if (replyId !== undefined) lines.push(`${indent}Reply(${replyId});`);
    for (const c of state.choices) {
        const id = bareMsgId(c.text);
        if (id !== undefined) lines.push(`${indent}${serializeSSLOption(c, id)}`);
    }
    return `function ${state.id}() {\n${lines.join("\n")}${lines.length > 0 ? "\n" : ""}}`;
}
