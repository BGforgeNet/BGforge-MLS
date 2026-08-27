import type { DialogModel } from "../../../../shared/dialog-model";
import { isRecord } from "../../is-record";

/**
 * Messages the dialog webview posts up to the host. Senders: main.ts ("ready", plus "runtimeError" via
 * installFatalErrorHandler) and DialogGraph.svelte (all the rest).
 *
 * ONE union for both hosts, because there is one webview: `panel.ts` (dialog source) and `dlg-panel.ts`
 * (compiled dialog) load the same bundle, so a message either host can receive belongs here. While the
 * compiled-dialog messages were missing, its host could not use the guard below and hand-rolled a cast
 * instead - which is how it came to have no "runtimeError" branch at all, silently dropping a fatal error
 * the other two hosts report.
 *
 * A host handling only some of these is normal - `revealSource` means nothing for a compiled dialog, and
 * `detach` nothing for source - and each ignores what it does not implement.
 */
export type WebviewToHost =
    | { type: "ready" }
    | { type: "revealSource"; offset: number }
    | { type: "notify"; text: string; level?: "info" | "warn" }
    | { type: "edit"; model: DialogModel; seq?: number }
    | { type: "runtimeError"; message: string; stack?: string }
    /** The strrefs could not be resolved; the webview cannot run a command, so it asks the host to open a game. */
    | { type: "openGame" }
    /** Repoint one line of a compiled dialog at another string, addressed by position. */
    | { type: "pickString"; stateIndex: number; choiceIndex?: number }
    /** Detach one state of a compiled dialog, addressed by position. */
    | { type: "detach"; stateIndex: number };

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
        case "openGame":
            return true;
        case "pickString":
            return (
                typeof m.stateIndex === "number" && (m.choiceIndex === undefined || typeof m.choiceIndex === "number")
            );
        case "detach":
            return typeof m.stateIndex === "number";
        default:
            return false;
    }
}
