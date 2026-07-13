import type { DialogModel } from "../../../../shared/dialog-model";

/**
 * Messages the dialog webview posts up to the host (panel.ts). Senders: main.ts ("ready",
 * plus "runtimeError" via installFatalErrorHandler) and DialogGraph.svelte ("revealSource",
 * "edit", "notify").
 */
export type WebviewToHost =
    | { type: "ready" }
    | { type: "revealSource"; offset: number }
    | { type: "notify"; text: string; level?: "info" | "warn" }
    | { type: "edit"; model: DialogModel; seq?: number }
    | { type: "runtimeError"; message: string; stack?: string };

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null;
}

/**
 * Runtime narrow of an incoming webview message before the host acts on it. A same-origin webview
 * channel is not an external trust boundary, so this is defense-in-depth - the same posture as the
 * binary editor's isWebviewToHost (binary-editor/webview/messages.ts). Validates the discriminant
 * plus the primitive fields each handler branch reads; the "edit" model payload is checked to be an
 * object and validated structurally downstream (host-core serialization + LSP round-trip).
 */
export function isWebviewToHost(m: unknown): m is WebviewToHost {
    if (!isRecord(m) || typeof m.type !== "string") return false;
    switch (m.type) {
        case "ready":
            return true;
        case "revealSource":
            return typeof m.offset === "number";
        case "notify":
            return typeof m.text === "string" && (m.level === undefined || typeof m.level === "string");
        case "edit":
            return isRecord(m.model) && (m.seq === undefined || typeof m.seq === "number");
        case "runtimeError":
            return typeof m.message === "string";
        default:
            return false;
    }
}
