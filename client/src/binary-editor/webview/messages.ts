import type { ChangeSet, Diagnostic, NodeId, OpenResult, Row, StructureOpRequest } from "@bgforge/binary-editor";

/** Messages the webview posts up to the host. */
export type WebviewToHost =
    | { type: "ready" }
    | { type: "requestChildren"; requestId: number; nodeId: NodeId | null; start: number; end: number }
    | { type: "editField"; nodeId: NodeId; value: number | string }
    | { type: "structureOp"; op: StructureOpRequest }
    | { type: "dumpJson" }
    | { type: "loadJson" }
    | { type: "runtimeError"; message: string; stack?: string };

/** Messages the host posts down to the webview. */
export type HostToWebview =
    | { type: "init"; open: OpenResult }
    | { type: "children"; requestId: number; parentId: NodeId | null; rows: Row[]; total: number }
    | { type: "changeSet"; changeSet: ChangeSet }
    | { type: "invalidated" }
    | { type: "diagnostics"; diagnostics: Diagnostic[] }
    | { type: "error"; requestId?: number; message: string };
