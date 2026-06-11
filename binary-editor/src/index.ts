// Public surface of the framework-agnostic binary editor core.
// MUST NOT import `vscode`, `vscode-languageserver`, or any DOM type.
export type {
    SessionId,
    NodeId,
    NamePath,
    Row,
    Diagnostic,
    ChangeSet,
    EditResult,
    StructureResult,
    LayoutDescriptor,
    OpenResult,
} from "./types";

export type { LayoutSection, ResolvedLayout, ResolvedTab } from "./types";
export type { DetailBlock, DetailPanel, DetailRow, FieldRef, LayoutChildList, LayoutRow } from "@bgforge/binary";

export { dispatch } from "./protocol";
export type { Request, Response } from "./protocol";
export type { StructureOpRequest } from "./structure-ops";
export { openSession, closeSession } from "./session";
export { buildDetailFieldMap, detailVariantRefs, detailVariantResolves } from "./detail-layout";
// Spellbook view + edit-op types crossing to the webview/client; the projection itself and its sub-types are
// internal (the dispatch handler and the structural view are accessed through SpellbookView structurally).
export type { SpellbookView } from "./spellbook";
export type { SpellbookEditOp } from "./spellbook-ops";
