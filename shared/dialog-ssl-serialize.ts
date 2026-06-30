import type { DialogChoice, DialogState } from "./dialog-model";

/**
 * Emit the SSL source for a NEW dialog option, given its already-allocated `.msg` id. A node target becomes
 * `NOption(<id>, <Node>, <skill?>);`; an exit/terminal becomes `NMessage(<id>);`. The msg arg is the bare
 * numeric id (the `.ssl` references ids by number; `@N` is only the model's display form). Tier 2 emits the
 * neutral `N*` variant only - G/B/Low variants and `Reply` lines are not generated. The serializer emits a
 * canonical single statement; surrounding whitespace/indentation is the caller's (the insertion splice).
 *
 * An external-target option is not a Tier 2 add case (you cannot add a cross-file option from the graph), so
 * any non-state target is treated as a terminal `NMessage`.
 */
export function serializeSSLOption(choice: DialogChoice, msgId: number): string {
    if (choice.target.kind === "state") {
        const skill = choice.skill !== undefined ? `, ${choice.skill}` : "";
        return `NOption(${msgId}, ${choice.target.stateId}${skill});`;
    }
    return `NMessage(${msgId});`;
}

/**
 * Normalize a condition expression to exactly one balanced outer-paren layer. SSL conditions must be
 * parenthesized; conditions captured from the grammar already carry their parens, so this avoids
 * double-wrapping while also ensuring a bare expression gains them. `"(a) and (b)"` closes depth=0
 * before the end, so isBalanced returns false and the expression is wrapped.
 */
export function serializeCond(cond: string): string {
    const t = cond.trim();
    return /^\(.*\)$/s.test(t) && isBalanced(t) ? t : `(${t})`;
}

function isBalanced(s: string): boolean {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        if (s[i] === "(") depth++;
        else if (s[i] === ")") {
            depth--;
            if (depth === 0 && i < s.length - 1) return false; // closed before the end
        }
    }
    return depth === 0;
}

/**
 * Emit a NEW conditional option: an `if (<cond>) then` wrapper over a single serialized dialog call,
 * indented one step (4 spaces) deeper than the `if`. `indent` is the outer indentation level (the
 * caller prepends it to the `if` line); the inner call sits at `indent + 4 spaces`. Used by the wrap
 * operation. Reuses `serializeSSLOption` for the inner call.
 */
export function serializeSSLConditionalOption(
    choice: DialogChoice,
    msgId: number,
    cond: string,
    indent: string,
): string {
    return `if ${serializeCond(cond)} then\n${indent}    ${serializeSSLOption(choice, msgId)}`;
}

/** A node's NPC reply line, by allocated msg id. */
export function serializeSSLReply(msgId: number): string {
    return `Reply(${msgId});`;
}

/**
 * Emit a NEW `if`/`else` bundle branch block. For an `if` branch the header is
 * `if <serializeCond(cond)> then begin`; for an `else` branch it is `else begin` (condition
 * unused). The body is reply line(s) then option lines, each indented at `indent + 4 spaces`,
 * joined with `\n`. An empty body (no replies, no options) yields `... begin\n${indent}end`.
 * The closing `end` is always at column `indent`. The returned string does not start with `indent`
 * itself - the caller prepends that.
 */
export function serializeSSLBranch(
    kind: "if" | "else",
    cond: string | undefined,
    replyMsgIds: number[],
    options: { choice: DialogChoice; msgId: number }[],
    indent: string,
): string {
    const header = kind === "if" ? `if ${serializeCond(cond!)} then begin` : `else begin`;
    const innerIndent = `${indent}    `;
    const lines: string[] = [];
    for (const id of replyMsgIds) lines.push(`${innerIndent}${serializeSSLReply(id)}`);
    for (const { choice, msgId } of options) lines.push(`${innerIndent}${serializeSSLOption(choice, msgId)}`);
    return `${header}\n${lines.join("\n")}${lines.length > 0 ? "\n" : ""}${indent}end`;
}

/** Msg ids for a new node: its reply line (when it has text) and each option keyed by choice id. */
export interface NodeMsgIds {
    reply: number | undefined;
    options: Record<string, number>;
}

/**
 * Emit a whole `procedure <name> begin ... end` for a NEW node: the reply line (if any) then each option, one
 * statement per line at `indent`. Reuses `serializeSSLOption`. Only unconditional options are emitted (a new
 * node carries none - condition editing is Tier 3b). Options without an allocated id are skipped defensively.
 */
export function serializeSSLProcedure(state: DialogState, ids: NodeMsgIds, indent: string): string {
    const lines: string[] = [];
    if (state.text.trim() !== "" && ids.reply !== undefined) lines.push(`${indent}${serializeSSLReply(ids.reply)}`);
    for (const c of state.choices) {
        const id = ids.options[c.id];
        if (id !== undefined) lines.push(`${indent}${serializeSSLOption(c, id)}`);
    }
    return `procedure ${state.id} begin\n${lines.join("\n")}${lines.length > 0 ? "\n" : ""}end`;
}
