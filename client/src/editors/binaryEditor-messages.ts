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
    /** New raw numeric value */
    readonly value: number;
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

export type WebviewToExtension =
    | EditMessage
    | ReadyMessage
    | GetChildrenMessage
    | DumpJsonMessage
    | LoadJsonMessage
    | RuntimeErrorMessage;

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
    /** New raw value */
    readonly rawValue: number;
}

interface ValidationErrorMessage {
    readonly type: "validationError";
    readonly fieldId?: string;
    readonly fieldPath: string;
    readonly message: string;
}

export type ExtensionToWebview = InitMessage | ChildrenMessage | UpdateFieldMessage | ValidationErrorMessage;
