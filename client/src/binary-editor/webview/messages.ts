import type {
    ChangeSet,
    Diagnostic,
    EffectTreeView,
    NodeId,
    OpenResult,
    Row,
    SpellbookEditOp,
    SpellbookView,
    StructureOpRequest,
} from "@bgforge/binary-editor";
import { isRecord } from "../../is-record";

/** Messages the webview posts up to the host. */
export type WebviewToHost =
    | { type: "ready" }
    | { type: "requestChildren"; requestId: number; nodeId: NodeId | null; start: number; end: number }
    | { type: "requestSpellbook"; requestId: number }
    | { type: "requestEffectTree"; requestId: number }
    | { type: "requestResourceList"; requestId: number; ext: string }
    | { type: "requestThumbnail"; requestId: number; resref: string; ext: string }
    | { type: "editField"; nodeId: NodeId; value: number | string }
    | { type: "structureOp"; op: StructureOpRequest }
    | { type: "spellbookEdit"; op: SpellbookEditOp }
    | { type: "openResource"; resref: string; ext: string }
    | { type: "dumpJson" }
    | { type: "loadJson" }
    | { type: "runtimeError"; message: string; stack?: string };

/**
 * Runtime narrow of an incoming webview message before the host acts on it. A same-origin webview
 * channel is not an external trust boundary, so this is defense-in-depth - it brings the binary
 * editor to the dialog editor's posture (per-field narrowing) instead of a blanket cast. Validates
 * the discriminant plus the primitive fields each handler branch reads; the nested op payloads
 * (structureOp/spellbookEdit) are checked to be objects and re-validated by the worker downstream.
 */
export function isWebviewToHost(m: unknown): m is WebviewToHost {
    if (!isRecord(m) || typeof m.type !== "string") return false;
    switch (m.type) {
        case "ready":
        case "dumpJson":
        case "loadJson":
            return true;
        case "openResource":
            return typeof m.resref === "string" && typeof m.ext === "string";
        case "requestSpellbook":
        case "requestEffectTree":
            return typeof m.requestId === "number";
        case "requestResourceList":
            return typeof m.requestId === "number" && typeof m.ext === "string";
        case "requestThumbnail":
            return typeof m.requestId === "number" && typeof m.resref === "string" && typeof m.ext === "string";
        case "requestChildren":
            return (
                typeof m.requestId === "number" &&
                (m.nodeId === null || typeof m.nodeId === "string") &&
                typeof m.start === "number" &&
                typeof m.end === "number"
            );
        case "editField":
            return typeof m.nodeId === "string" && (typeof m.value === "number" || typeof m.value === "string");
        case "structureOp":
        case "spellbookEdit":
            return isRecord(m.op);
        case "runtimeError":
            return typeof m.message === "string";
        default:
            return false;
    }
}

/** Messages the host posts down to the webview. */
export type HostToWebview =
    | { type: "init"; open: OpenResult }
    | { type: "children"; requestId: number; parentId: NodeId | null; rows: Row[]; total: number }
    | { type: "spellbook"; requestId: number; view: SpellbookView }
    | { type: "effectTree"; requestId: number; view: EffectTreeView }
    /** Every resref of one type the open game holds - the suggestion set behind a resref field's picker.
     *  Empty for a record outside a game, which is also how a picker with nothing to offer degrades. */
    | { type: "resourceList"; requestId: number; resrefs: readonly string[] }
    /** A `data:` URI for a resref field's picture, or undefined when the resource is gone or undrawable.
     *  A string rather than bytes because a `Uint8Array` does not survive `postMessage` on every host, and
     *  because the view puts it straight into an `<img src>`. */
    | { type: "thumbnail"; requestId: number; dataUri?: string }
    | { type: "changeSet"; changeSet: ChangeSet; selection?: NodeId }
    | { type: "invalidated" }
    | { type: "diagnostics"; diagnostics: Diagnostic[] }
    | { type: "error"; requestId?: number; message: string };
