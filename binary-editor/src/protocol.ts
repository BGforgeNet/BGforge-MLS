import type { ParseOptions } from "@bgforge/binary";
import { closeSession, openSession, sessionStore, type EditorSession } from "./session";
import { setExpanded } from "./model";
import { getWindow } from "./window";
import { editField } from "./edit";
import { structureOp, undo as doUndo, redo as doRedo, type StructureOpRequest } from "./structure-ops";
import { serializeSession } from "./serialize";
import { validate } from "./validate";
import type { EditResult, OpenResult, Row, SessionId, StructureResult } from "./types";

export type Request =
    | { type: "open"; uri: string; bytes: Uint8Array; options?: ParseOptions }
    | { type: "close"; sessionId: SessionId }
    | { type: "getWindow"; sessionId: SessionId; start: number; end: number }
    | { type: "expand"; sessionId: SessionId; nodeId: string; expanded: boolean }
    | { type: "editField"; sessionId: SessionId; nodeId: string; value: number | string }
    | { type: "structureOp"; sessionId: SessionId; op: StructureOpRequest }
    | { type: "undo"; sessionId: SessionId }
    | { type: "redo"; sessionId: SessionId }
    | { type: "serialize"; sessionId: SessionId }
    | { type: "validate"; sessionId: SessionId };

export type Response =
    | { type: "opened"; result: OpenResult }
    | { type: "closed" }
    | { type: "window"; rows: Row[] }
    | { type: "edited"; result: EditResult }
    | { type: "structure"; result: StructureResult }
    | { type: "serialized"; bytes: Uint8Array }
    | { type: "diagnostics"; diagnostics: ReturnType<typeof validate> }
    | { type: "error"; message: string };

function need(sessionId: SessionId): EditorSession {
    const s = sessionStore.get(sessionId);
    if (!s) throw new Error(`Unknown session ${sessionId}`);
    return s;
}

export function dispatch(req: Request): Response {
    try {
        switch (req.type) {
            case "open":
                // A parse/extension failure is carried inside the OpenResult (empty sessionId plus
                // errors[] and any known format/formatName), not raised as an {type:"error"} response,
                // so the editor shell can show the failure with format context instead of a bare message.
                return { type: "opened", result: openSession(req.uri, req.bytes, req.options) };
            case "close":
                closeSession(req.sessionId);
                return { type: "closed" };
            case "getWindow":
                return { type: "window", rows: getWindow(need(req.sessionId).model, req.start, req.end) };
            case "expand": {
                const s = need(req.sessionId);
                setExpanded(s.model, req.nodeId, req.expanded);
                return { type: "window", rows: getWindow(s.model, 0, 500) };
            }
            case "editField":
                return { type: "edited", result: editField(need(req.sessionId), req.nodeId, req.value) };
            case "structureOp":
                return { type: "structure", result: structureOp(need(req.sessionId), req.op) };
            case "undo": {
                const s = need(req.sessionId);
                doUndo(s);
                return { type: "window", rows: getWindow(s.model, 0, 500) };
            }
            case "redo": {
                const s = need(req.sessionId);
                doRedo(s);
                return { type: "window", rows: getWindow(s.model, 0, 500) };
            }
            case "serialize":
                return { type: "serialized", bytes: serializeSession(need(req.sessionId)) };
            case "validate":
                return { type: "diagnostics", diagnostics: validate(need(req.sessionId)) };
            default: {
                // Exhaustiveness guard: every member of the Request union is handled above.
                // This branch is unreachable at runtime; it exists only to satisfy tsc's
                // control-flow analysis when strict mode cannot prove the switch is total.
                const exhaustive: never = req;
                throw new Error(`Unknown request type: ${(exhaustive as Request).type}`);
            }
        }
    } catch (error) {
        return { type: "error", message: error instanceof Error ? error.message : String(error) };
    }
}
