import type { DialogChoice, DialogReaction, DialogState } from "./dialog-model";

const REACTION_PREFIX: Record<DialogReaction, string> = { good: "G", neutral: "N", bad: "B" };

/**
 * The SSL macro name for a dialog-option choice: the reaction prefix (default neutral) plus `Low` when
 * the choice is the low-INT variant. Shared by `serializeSSLOptionCall` (below) and the write-back
 * splicer's in-place reaction/lowIq rewrite (`dialog-ssl-edit.ts`), so the macro-name rule lives once.
 */
export function sslOptionMacro(choice: DialogChoice): string {
    return `${REACTION_PREFIX[choice.reaction ?? "neutral"]}${choice.lowIq ? "Low" : ""}Option`;
}

/**
 * Emit the bare call expression (no trailing `;`) for a dialog option targeting a node. The engine's
 * `*LowOption` macros are 2-arg (`NLowOption(msg, target)`) - the IQ gate is hardcoded to the engine's
 * LOW_IQ constant, so there is no explicit third arg; the non-Low macros are always 3-arg
 * (`NOption(msg, target, skill)`, `skill` 0 meaning no INT gate). `msgIdText` is the already-formatted
 * msg-id argument text - a bare number for a newly-serialized option, or the original source expression
 * preserved verbatim by the write-back splicer, so a computed/`random(...)` msgId round-trips intact.
 */
export function serializeSSLOptionCall(choice: DialogChoice, msgIdText: string, target: string): string {
    const macro = sslOptionMacro(choice);
    return choice.lowIq
        ? `${macro}(${msgIdText}, ${target})`
        : `${macro}(${msgIdText}, ${target}, ${choice.skill ?? 0})`;
}

/**
 * Emit the SSL source for a NEW dialog option, given its already-allocated `.msg` id. A node target becomes
 * `<Macro>(<id>, <Node>[, <skill>]);` (see `serializeSSLOptionCall`); an exit/terminal becomes `NMessage(<id>);`.
 * The msg arg is the bare numeric id (the `.ssl` references ids by number; `@N` is only the model's display
 * form). The serializer emits a canonical single statement; surrounding whitespace/indentation is the
 * caller's (the insertion splice).
 *
 * An external-target option is not an add case (you cannot add a cross-file option from the graph), so
 * any non-state target is treated as a terminal `NMessage` - reaction is not modeled for terminal messages,
 * so this always emits the neutral `NMessage` regardless of `choice.reaction`.
 */
export function serializeSSLOption(choice: DialogChoice, msgId: number): string {
    if (choice.target.kind === "state") {
        return `${serializeSSLOptionCall(choice, String(msgId), choice.target.stateId)};`;
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

/**
 * The conventional Fallout dialog support nodes and their default bodies (SSL only). Node999 is the end/leave
 * node - an empty procedure (selecting an option that `call`s it simply ends the gSay turn); this matches the
 * corpus, where `procedure Node999 begin end` is the norm. Node998 is the combat node - its default body sets
 * the critter hostile before the dialog closes. Body lines are already indented to the procedure-body level;
 * an empty array yields a bare `begin ... end`. The editor presents an option targeting these as an Exit /
 * Combat terminal chip rather than a drawn node (see SSL_TERMINAL_NODES in dialog-model.ts).
 */
const SSL_SUPPORT_BODIES: Record<string, string[]> = {
    Node998: ["    if (hostile == false) then begin", "        set_hostile;", "    end"],
    Node999: [],
};

/** Serialize one support procedure with its default body (empty body -> `procedure X begin\nend`). */
export function serializeSupportProcedure(id: string): string {
    const body = SSL_SUPPORT_BODIES[id] ?? [];
    return `procedure ${id} begin\n${body.length > 0 ? `${body.join("\n")}\n` : ""}end`;
}

/**
 * Emit a whole from-scratch dialog skeleton for an SSL file that has no `talk_p_proc` (a blank file, or a
 * critter/scenery script that has no dialog yet). Without this the graph's `+ State` has nothing to splice
 * into - the ADD path anchors new node procedures before `talk_p_proc`, and there is none.
 *
 * The emitted skeleton is: forward declarations for `talk_p_proc`, the new node(s), and each EMITTED support
 * node; a `talk_p_proc` entry router that `call`s each entry node inside the standard `start_gdialog(...) /
 * gSay_Start ... gSay_End / end_dialogue` frame; each new node's already-serialized procedure
 * (`nodeProcedures`, in order); and the emitted support nodes with their default bodies. `nodeIds` are the new
 * nodes' ids (for the forward decls); `entryIds` the subset the router calls (the bootstrap entry);
 * `emitSupport` the support-node ids to write - the caller passes only those NOT already present in the file,
 * so an existing Node998/Node999 is left untouched.
 *
 * `start_gdialog` references `NAME` (the script's `#define`) and `self_obj` - a real scenery/critter script
 * already provides them, so the skeleton drops straight in; a truly blank file must still add its own
 * `#include`/`#define NAME` and message file to compile. Scaffolding the dialog structure (this tool's job)
 * is deliberately kept separate from scaffolding a whole compilable script.
 */
export function serializeSSLDialogScaffold(
    entryIds: string[],
    nodeIds: string[],
    nodeProcedures: string[],
    emitSupport: string[],
): string {
    const decls = [
        "procedure talk_p_proc;",
        ...nodeIds.map((id) => `procedure ${id};`),
        ...emitSupport.map((id) => `procedure ${id};`),
    ].join("\n");
    // Route to the entry node(s). A from-scratch dialog always has at least one (the bootstrap node is flagged
    // isEntry), but guard anyway: an empty router would compile to a dialog that opens and immediately ends.
    const router = (entryIds.length > 0 ? entryIds : nodeIds).map((id) => `        call ${id};`).join("\n");
    const talk = [
        "procedure talk_p_proc begin",
        "    start_gdialog(NAME, self_obj, 4, -1, -1);",
        "    gSay_Start;",
        router,
        "    gSay_End;",
        "    end_dialogue;",
        "end",
    ].join("\n");
    const support = emitSupport.map((id) => serializeSupportProcedure(id));
    return [decls, talk, ...nodeProcedures, ...support].join("\n\n");
}
