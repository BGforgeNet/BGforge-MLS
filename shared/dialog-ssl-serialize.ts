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

/** A node's NPC reply line, by allocated msg id. */
export function serializeSSLReply(msgId: number): string {
    return `Reply(${msgId});`;
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
