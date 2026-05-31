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
    SectionDescriptor,
    LayoutDescriptor,
    OpenResult,
} from "./types";

export { dispatch } from "./protocol";
export type { Request, Response } from "./protocol";
export { openSession, closeSession } from "./session";
