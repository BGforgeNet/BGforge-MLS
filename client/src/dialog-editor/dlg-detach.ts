/**
 * What the user is told before and after detaching a compiled dialog's state.
 *
 * The wording carries the one thing that makes detaching safe to offer at all: the state is NOT removed. Its
 * record and its number stay, because other dialogs - and WeiDU mod scripts, which this editor cannot see -
 * address states by number. Only the replies inside this dialog stop leading there.
 *
 * Kept pure so the distinction the whole feature turns on is testable: "no other dialog reaches this state"
 * and "we have not finished checking" must never render as the same sentence.
 */

import type { InboundRef } from "./dlg-references";
import type { DlgReplyRef } from "../../../shared/dialog-dlg-edit";

export interface DetachSummary {
    readonly resref: string;
    readonly stateIndex: number;
    /** Replies in THIS dialog that lead to the state; these are the ones that will end the conversation. */
    readonly local: readonly DlgReplyRef[];
    /** Replies in OTHER dialogs. `undefined` means the index has not finished - not that there are none. */
    readonly external: readonly InboundRef[] | undefined;
}

const count = (n: number, singular: string, plural: string): string => `${n} ${n === 1 ? singular : plural}`;

/** Replies are shown 1-based; a state's number is the file's own and stays as it is. */
const replyAt = (ref: DlgReplyRef): string => `state ${ref.stateIndex}, reply ${ref.choiceIndex + 1}`;

export function detachConfirmMessage(summary: DetachSummary): string {
    const local =
        summary.local.length === 0
            ? "No reply in this dialog leads to it."
            : `${count(summary.local.length, "reply", "replies")} in this dialog lead${summary.local.length === 1 ? "s" : ""} to it and will end the conversation instead: ${summary.local.map((ref) => replyAt(ref)).join("; ")}.`;
    const lines = [`Detach state ${summary.stateIndex} of ${summary.resref}?`, local];

    if (summary.external === undefined) {
        lines.push("Other dialogs have not been checked yet - the reference scan is still building.");
    } else if (summary.external.length === 0) {
        lines.push("No other dialog reaches this state.");
    } else {
        const files = [...new Set(summary.external.map((ref) => ref.dialog))].sort();
        lines.push(
            `${count(summary.external.length, "reply", "replies")} in ${count(files.length, "other dialog", "other dialogs")} will still reach it: ${files.join(", ")}. Those files are not changed.`,
        );
    }

    lines.push("The state itself remains in the file, keeping its number, so nothing else is renumbered.");
    return lines.join("\n\n");
}

export function detachResultMessage(stateIndex: number, cut: readonly DlgReplyRef[]): string {
    if (cut.length === 0) return `Detached state ${stateIndex}. No replies led to it, so nothing else changed.`;
    return `Detached state ${stateIndex}. Now ending the conversation: ${cut.map((ref) => replyAt(ref)).join("; ")}.`;
}
