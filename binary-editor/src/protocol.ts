import { formatAdapterRegistry, loadBinaryJsonSnapshot, type ParseOptions } from "@bgforge/binary";
import { closeSession, openSession, sessionStore, type EditorSession } from "./session";
import { buildModel, setExpanded } from "./model";
import { buildLayout } from "./layout";
import { DEFAULT_WINDOW, getChildren, getWindow } from "./window";
import { editField } from "./edit";
import { structureOp, undo as doUndo, redo as doRedo, type StructureOpRequest } from "./structure-ops";
import { spellbookEdit, type SpellbookEditOp } from "./spellbook-ops";
import { serializeSession } from "./serialize";
import { validate } from "./validate";
import { projectSpellbook, type SpellbookView } from "./spellbook";
import { projectEffectTree, type EffectTreeView } from "./effect-tree";
import type { EditResult, NodeId, OpenResult, Row, SessionId, StructureResult } from "./types";

export type Request =
    | {
          type: "open";
          uri: string;
          bytes: Uint8Array;
          options?: ParseOptions;
          /** IE engine key of the game this record came from, where the host knows one. */ engine?: string;
      }
    | { type: "close"; sessionId: SessionId }
    | { type: "getWindow"; sessionId: SessionId; start: number; end: number }
    | { type: "expand"; sessionId: SessionId; nodeId: string; expanded: boolean }
    | { type: "editField"; sessionId: SessionId; nodeId: string; value: number | string }
    | { type: "structureOp"; sessionId: SessionId; op: StructureOpRequest }
    | { type: "spellbookEdit"; sessionId: SessionId; op: SpellbookEditOp }
    | { type: "undo"; sessionId: SessionId }
    | { type: "redo"; sessionId: SessionId }
    | { type: "serialize"; sessionId: SessionId }
    | { type: "validate"; sessionId: SessionId }
    | { type: "snapshot"; sessionId: SessionId }
    | { type: "getChildren"; sessionId: SessionId; nodeId: NodeId | null; start: number; end: number }
    | { type: "getSpellbook"; sessionId: SessionId }
    | { type: "getEffectTree"; sessionId: SessionId }
    | { type: "loadJson"; sessionId: SessionId; json: string };

export type Response =
    | { type: "opened"; result: OpenResult }
    | { type: "closed" }
    | { type: "window"; rows: Row[]; dirty: boolean }
    | { type: "edited"; result: EditResult }
    | { type: "structure"; result: StructureResult }
    | { type: "serialized"; bytes: Uint8Array }
    | { type: "diagnostics"; diagnostics: ReturnType<typeof validate> }
    | { type: "snapshot"; json: string }
    | { type: "children"; parentId: NodeId | null; rows: Row[]; total: number }
    | { type: "spellbook"; view: SpellbookView }
    | { type: "effectTree"; view: EffectTreeView }
    | { type: "error"; message: string };

function need(sessionId: SessionId): EditorSession {
    const s = sessionStore.get(sessionId);
    if (!s) throw new Error(`Unknown session ${sessionId}`);
    return s;
}

function reopenResult(s: EditorSession): OpenResult {
    const pr = s.model.parseResult;
    return {
        sessionId: s.id,
        format: s.parserId,
        formatName: pr.formatName ?? s.parserId,
        layout: buildLayout(s.parserId, s.model, s.relationshipModel),
        warnings: pr.warnings ?? [],
        errors: pr.errors ?? [],
        rootWindow: getWindow(s.model, 0, DEFAULT_WINDOW, s.relationshipModel, s.composeSummary),
    };
}

export function dispatch(req: Request): Response {
    try {
        switch (req.type) {
            case "open":
                // A parse/extension failure is carried inside the OpenResult (empty sessionId plus
                // errors[] and any known format/formatName), not raised as an {type:"error"} response,
                // so the editor shell can show the failure with format context instead of a bare message.
                return { type: "opened", result: openSession(req.uri, req.bytes, req.options, req.engine) };
            case "close":
                closeSession(req.sessionId);
                return { type: "closed" };
            case "getWindow": {
                const s = need(req.sessionId);
                return {
                    type: "window",
                    rows: getWindow(s.model, req.start, req.end, s.relationshipModel, s.composeSummary),
                    dirty: s.dirty,
                };
            }
            case "getChildren": {
                const s = need(req.sessionId);
                const { rows, total } = getChildren(
                    s.model,
                    req.nodeId,
                    req.start,
                    req.end,
                    s.relationshipModel,
                    s.composeSummary,
                );
                return { type: "children", parentId: req.nodeId, rows, total };
            }
            case "getSpellbook": {
                const s = need(req.sessionId);
                return { type: "spellbook", view: projectSpellbook(s.model) };
            }
            case "getEffectTree": {
                const s = need(req.sessionId);
                return { type: "effectTree", view: projectEffectTree(s.model) };
            }
            case "expand": {
                const s = need(req.sessionId);
                setExpanded(s.model, req.nodeId, req.expanded);
                return {
                    type: "window",
                    rows: getWindow(s.model, 0, DEFAULT_WINDOW, s.relationshipModel, s.composeSummary),
                    dirty: s.dirty,
                };
            }
            case "editField":
                return { type: "edited", result: editField(need(req.sessionId), req.nodeId, req.value) };
            case "structureOp":
                return { type: "structure", result: structureOp(need(req.sessionId), req.op) };
            case "spellbookEdit":
                return { type: "structure", result: spellbookEdit(need(req.sessionId), req.op) };
            case "undo":
                return { type: "structure", result: doUndo(need(req.sessionId)) };
            case "redo":
                return { type: "structure", result: doRedo(need(req.sessionId)) };
            case "serialize":
                return { type: "serialized", bytes: serializeSession(need(req.sessionId)) };
            case "validate":
                return { type: "diagnostics", diagnostics: validate(need(req.sessionId)) };
            case "snapshot": {
                const s = need(req.sessionId);
                const adapter = formatAdapterRegistry.get(s.parserId);
                if (!adapter) throw new Error(`No format adapter for ${s.parserId}`);
                return { type: "snapshot", json: adapter.createJsonSnapshot(s.model.parseResult) };
            }
            case "loadJson": {
                const s = need(req.sessionId);
                // loadBinaryJsonSnapshot throws on malformed/wrong-format input; the throw
                // happens before any state mutation, so a failed load leaves the session unchanged.
                const { parseResult } = loadBinaryJsonSnapshot(req.json, s.parseOptions);
                s.undo.push({ label: "Load JSON", before: s.model.parseResult });
                s.redo = [];
                s.model = buildModel(parseResult);
                s.dirty = true;
                return { type: "opened", result: reopenResult(s) };
            }
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
