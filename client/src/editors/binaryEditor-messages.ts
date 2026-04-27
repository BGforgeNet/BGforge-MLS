/**
 * Typed message protocol for binary editor webview <-> extension host communication.
 * All messages are serialized via postMessage as JSON.
 */

export interface BinaryEditorNode {
    readonly id: string;
    readonly parentId: string;
    readonly kind: "group" | "field";
    readonly name: string;
    readonly description?: string;
    readonly expandable: boolean;
    readonly expanded?: boolean;
    readonly fieldId?: string;
    readonly fieldKey?: string;
    readonly fieldPath?: string;
    readonly flagActivation?: Record<string, "set" | "clear" | "equal">;
    readonly editable?: boolean;
    readonly value?: string;
    readonly rawValue?: number | string;
    readonly offset?: number;
    readonly size?: number;
    readonly valueType?: string;
    readonly numericFormat?: "decimal" | "hex32";
    readonly enumOptions?: Record<number, string>;
    readonly flagOptions?: Record<number, string>;
    /**
     * Charset restriction for string-typed fields. Sourced from the
     * presentation schema by the extension host and passed down to the webview
     * so live keystroke sanitization mirrors the host-side validator.
     */
    readonly stringCharset?: "ascii-printable" | "utf8";
    /** Group nodes whose array accepts new entries (e.g. MAP "Global Variables"). */
    readonly addable?: boolean;
    /** Source segments identifying the addable array (only set when `addable`). */
    readonly arrayPath?: readonly string[];
    /** Field/entry nodes that can be removed from their parent array. */
    readonly removable?: boolean;
    /** Source segments identifying the removable entry (only set when `removable`). */
    readonly entryPath?: readonly string[];
}

// -- Webview -> Extension ---------------------------------------------------
//
// The arms below are only referenced via the WebviewToExtension union; consumers
// pattern-match on `msg.type` and TypeScript narrows structurally. Keep them
// unexported so knip doesn't flag them as unused public symbols.

interface EditMessage {
    readonly type: "edit";
    /** Opaque source-tree identifier for the field */
    readonly fieldId: string;
    /** Dot-separated path from root to the field, e.g. "Header.Object Type" */
    readonly fieldPath: string;
    /** New raw value — numeric for int/uint/enum/flags fields, string for fixed-width string fields. */
    readonly value: number | string;
}

interface ReadyMessage {
    readonly type: "ready";
}

interface GetChildrenMessage {
    readonly type: "getChildren";
    readonly nodeId: string;
}

interface DumpJsonMessage {
    readonly type: "dumpJson";
}

interface LoadJsonMessage {
    readonly type: "loadJson";
}

interface RuntimeErrorMessage {
    readonly type: "runtimeError";
    readonly message: string;
    readonly stack?: string;
}

interface AddEntryMessage {
    readonly type: "addEntry";
    /** Source-tree segments identifying the addable array. */
    readonly arrayPath: readonly string[];
}

interface RemoveEntryMessage {
    readonly type: "removeEntry";
    /** Source-tree segments identifying the entry being removed. */
    readonly entryPath: readonly string[];
}

export type WebviewToExtension =
    | EditMessage
    | ReadyMessage
    | GetChildrenMessage
    | DumpJsonMessage
    | LoadJsonMessage
    | RuntimeErrorMessage
    | AddEntryMessage
    | RemoveEntryMessage;

// -- Extension -> Webview ---------------------------------------------------

export interface InitMessage {
    readonly type: "init";
    readonly format: string;
    readonly formatName: string;
    readonly rootChildren: BinaryEditorNode[];
    readonly warnings?: string[];
    readonly errors?: string[];
}

interface ChildrenMessage {
    readonly type: "children";
    readonly nodeId: string;
    readonly children: BinaryEditorNode[];
}

interface UpdateFieldMessage {
    readonly type: "updateField";
    readonly fieldId: string;
    /** Dot-separated path to the changed field */
    readonly fieldPath: string;
    /** New display value */
    readonly displayValue: string;
    /** New raw value — numeric for int/uint/enum/flags, string for fixed-width string fields. */
    readonly rawValue: number | string;
}

interface ValidationErrorMessage {
    readonly type: "validationError";
    readonly fieldId?: string;
    readonly fieldPath: string;
    readonly message: string;
}

export type ExtensionToWebview = InitMessage | ChildrenMessage | UpdateFieldMessage | ValidationErrorMessage;
