/**
 * TD source serializer for new transitions and whole new state functions. Mirrors `dialog-tssl-serialize.ts`
 * but emits TD's WeiDU-D-family vocabulary: a state is a `function id() { ... }`, its NPC line is `say(tra(N))`,
 * and a player option is a `reply(tra(M));` followed by its target call (`goTo(id)` / `exit()` / `extern(...)`)
 * in statement form - the shape the real `.td` corpus (e.g. botsmith.td) uses. Used by the TD add-option and
 * add-node writers in dialog-td-edit.ts. Text is expected already `@N`-allocated (dialog-td-ids.ts); a literal
 * or missing text emits no `tra(...)` line.
 */

import { bareMsgId } from "./dialog-edit-common";
import type { DialogChoice, DialogState, DialogTarget } from "./dialog-model";

/**
 * The target-producing call for a transition: a node target -> `goTo(<id>)`, a terminal -> `exit()`, a
 * cross-file target -> `extern("<file>", <state>)`. The `external` label is the adapter's `file:state` encoding
 * (`targetFromD`); COPY_TRANS keeps its sentinel prefix out of the call and is emitted as a best-effort
 * `extern` since add-option never authors one (it is a read-only construct in the editor).
 */
export function serializeTDTarget(target: DialogTarget): string {
    switch (target.kind) {
        case "state":
            return `goTo(${target.stateId})`;
        case "exit":
            return "exit()";
        case "external": {
            const rest = target.label.startsWith("COPY_TRANS ")
                ? target.label.slice("COPY_TRANS ".length)
                : target.label;
            const colon = rest.indexOf(":");
            const file = colon === -1 ? rest : rest.slice(0, colon);
            const state = colon === -1 ? "" : rest.slice(colon + 1);
            return `extern("${file}", ${state})`;
        }
        default: {
            // Exhaustiveness: a new DialogTarget kind must be given an explicit serialization here.
            const exhaustiveCheck: never = target;
            return exhaustiveCheck;
        }
    }
}

/**
 * Serialize one new player option as its statement group, `indent`-prefixed on every line:
 * `reply(tra(M));` then an optional `action(...)` then the target call `goTo(...)`/`exit()`. A textless
 * (pure-transition) choice omits the reply line.
 */
export function serializeTDTransition(choice: DialogChoice, indent = "    "): string {
    const lines: string[] = [];
    const replyId = bareMsgId(choice.text);
    if (replyId !== undefined) lines.push(`${indent}reply(tra(${replyId}));`);
    if (choice.action) lines.push(`${indent}action(${choice.action});`);
    lines.push(`${indent}${serializeTDTarget(choice.target)};`);
    return lines.join("\n");
}

/**
 * Serialize a new TD state as a `function <id>() { ... }` block. The NPC line becomes `say(tra(N))` when the
 * state carries a resolvable `@N`; each option is serialized by `serializeTDTransition`. Body lines are indented
 * by `indent`; the caller owns the surrounding whitespace (the insertion splice adds the blank line before the
 * primary wiring statement).
 */
export function serializeTDState(state: DialogState, indent = "    "): string {
    const lines: string[] = [];
    const sayId = bareMsgId(state.text);
    if (sayId !== undefined) lines.push(`${indent}say(tra(${sayId}));`);
    for (const c of state.choices) lines.push(serializeTDTransition(c, indent));
    return `function ${state.id}() {\n${lines.join("\n")}${lines.length > 0 ? "\n" : ""}}`;
}
