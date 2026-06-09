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
export type { DetailBlock, DetailPanel, DetailRow, FieldRef, LayoutRow } from "@bgforge/binary";

export { dispatch } from "./protocol";
export type { Request, Response } from "./protocol";
export type { StructureOpRequest } from "./structure-ops";
export { openSession, closeSession } from "./session";
export { buildDetailFieldMap, detailVariantRefs, detailVariantResolves } from "./detail-layout";
