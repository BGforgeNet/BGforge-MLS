import type { DialogChoice } from "./dialog-model";

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
