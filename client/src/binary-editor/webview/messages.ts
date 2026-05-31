import type { OpenResult, Row } from "@bgforge/binary-editor";

/** Messages the host posts down to the webview. */
export type HostToWebview =
    | { type: "init"; open: OpenResult }
    | { type: "window"; rows: Row[]; dirty: boolean }
    | { type: "error"; message: string };

/** Messages the webview posts up to the host. */
export type WebviewToHost =
    | { type: "ready" }
    | { type: "editField"; nodeId: string; value: number | string }
    | { type: "requestSave" };
