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
