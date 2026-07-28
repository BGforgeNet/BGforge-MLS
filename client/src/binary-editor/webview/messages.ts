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

/** Messages the webview posts up to the host. */
export type WebviewToHost =
    | { type: "ready" }
    | { type: "requestChildren"; requestId: number; nodeId: NodeId | null; start: number; end: number }
    | { type: "requestSpellbook"; requestId: number }
    | { type: "requestEffectTree"; requestId: number }
    | { type: "editField"; nodeId: NodeId; value: number | string }
    | { type: "structureOp"; op: StructureOpRequest }
    | { type: "spellbookEdit"; op: SpellbookEditOp }
    | { type: "openResource"; resref: string; ext: string }
    | { type: "dumpJson" }
    | { type: "loadJson" }
    | { type: "runtimeError"; message: string; stack?: string };

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null;
}

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
    | { type: "changeSet"; changeSet: ChangeSet; selection?: NodeId }
    | { type: "invalidated" }
    | { type: "diagnostics"; diagnostics: Diagnostic[] }
    | { type: "error"; requestId?: number; message: string };
