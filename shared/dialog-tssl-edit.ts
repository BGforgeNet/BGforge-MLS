/**
 * TSSL surgical source editor: splices field/structural edits back into the `.tssl` TypeScript SOURCE using the
 * byte ranges the source parser recorded (ranges into the .tssl, not generated SSL). Because a TSSL option call
 * is byte-identical to SSL (`NOption(101, Node002, 4)`), the ENTIRE write-back - per-node option edits, bundle
 * branch editing, and the whole-model orchestration (rename, delete, inbound-call removal, add-node, ensure
 * terminal, entry wiring) - is shared with the `.ssl` writer through `applyFalloutFamilyEdits`. Only the target
 * syntax differs (TS `function`/`{ }` vs SSL `procedure`/`begin`/`end`), and those pieces are supplied here as a
 * `FalloutFamilyWriteVariant`. This module is therefore just the variant plus a source-language guard; the two
 * variants of the family cannot drift on any operation, which retires the recurring "TSSL parity" defect class.
 */

import { applyFalloutFamilyEdits, type FalloutFamilyWriteVariant } from "./dialog-ssl-edit";
import { lineIndentAt } from "./dialog-edit-common";
import {
    serializeTSSLBranch,
    serializeTSSLConditionalOption,
    serializeTSSLProcedure,
    serializeTSSLSupportProcedure,
} from "./dialog-tssl-serialize";
import type { DialogModel, DialogState } from "./dialog-model";

/**
 * The reply-only add-option anchor for a TSSL node: the offset just before the function's closing brace, at the
 * body indent. The shared engine uses this only when a new option lands on a node with NO surviving option (a
 * say-only node); a node with a surviving option anchors the new option after it instead. This is TSSL's analogue
 * of the SSL `insertAnchor` the parser records - TSSL's node has a `}` close where SSL's has its captured anchor.
 */
function tsslBodyAnchor(text: string, orig: DialogState): { offset: number; indent: string } | undefined {
    if (!orig.procRange) return undefined;
    const close = text.lastIndexOf("}", orig.procRange.end - 1);
    if (close <= orig.procRange.start) return undefined;
    let bodyStart = orig.procRange.start;
    while (bodyStart < close && text[bodyStart] !== "\n") bodyStart++;
    return { offset: close, indent: lineIndentAt(text, bodyStart + 1) || "    " };
}

/**
 * The `.tssl` target syntax. `serializeScaffold` is intentionally omitted: a `.tssl` file with no `talk_p_proc`
 * router is a from-scratch scaffold, out of scope for the TSSL writer (the shared engine no-ops when it is absent).
 */
const TSSL_WRITE_VARIANT: FalloutFamilyWriteVariant = {
    serializeProcedure: serializeTSSLProcedure,
    serializeConditionalOption: serializeTSSLConditionalOption,
    serializeBranch: serializeTSSLBranch,
    serializeSupportNode: serializeTSSLSupportProcedure,
    serializeEntryCall: (id) => `${id}();`,
    declaresNode: (text, id) => new RegExp(String.raw`\bfunction\s+${id}\b`).test(text),
    bodyAnchor: tsslBodyAnchor,
};

/**
 * Compute the `.tssl` source with the model's surgical edits applied. Thin wrapper over the shared
 * `applyFalloutFamilyEdits` engine with the `.tssl` variant; guards the source language so a D/SSL/TD model is
 * never serialized as TSSL. Returns the text unchanged when nothing changed.
 *
 * @throws if `edited.sourceLang !== "tssl"` - a D/SSL/TD model must not be serialized as TSSL.
 */
export function applyTSSLDialogEdits(originalText: string, edited: DialogModel, original: DialogModel): string {
    if (edited.sourceLang !== "tssl") {
        throw new Error("applyTSSLDialogEdits: only tssl source models are supported");
    }
    return applyFalloutFamilyEdits(originalText, edited, original, TSSL_WRITE_VARIANT);
}
