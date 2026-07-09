/**
 * TSSL source serializer for whole new nodes. Mirrors `dialog-ssl-serialize.ts` `serializeSSLProcedure`, but
 * emits the TypeScript `function NodeNNN() { ... }` wrapper instead of SSL's `procedure ... begin ... end`.
 * The statement bodies (Reply / NOption / NMessage) are byte-identical to SSL, so the option lines reuse
 * `serializeSSLOption` unchanged - only the wrapper differs. Used by the add-node writer in dialog-tssl-edit.ts.
 */

import { bareMsgId } from "./dialog-edit-common";
import { serializeSSLOption } from "./dialog-ssl-serialize";
import type { DialogChoice, DialogState } from "./dialog-model";

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
