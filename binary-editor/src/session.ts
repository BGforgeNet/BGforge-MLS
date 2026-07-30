import { parserRegistry, type ParseOptions, type ParseResult } from "@bgforge/binary";
import { buildLayout } from "./layout";
import { buildModel, type Model } from "./model";
import { getRelationshipModel } from "./relationship/registry";
import type { RelationshipModel } from "./relationship/types";
import { DEFAULT_WINDOW, getWindow } from "./window";
import { summaryComposerFor, type SummaryComposer } from "./summary";
import type { OpenResult, Row, SessionId } from "./types";

export interface UndoEntry {
    label: string;
    before: ParseResult;
}

export interface EditorSession {
    id: SessionId;
    uri: string;
    parserId: string;
    parseOptions: ParseOptions;
    model: Model;
    relationshipModel?: RelationshipModel;
    /** Per-format summary composer, resolved once at open time. Undefined when no spec is registered. */
    composeSummary?: SummaryComposer;
    undo: UndoEntry[];
    redo: UndoEntry[];
    dirty: boolean;
}

export const sessionStore = new Map<SessionId, EditorSession>();

/**
 * Every form/grid layout field of the open document, re-projected through the relationship overlay. Shared
 * by both refresh paths - a single field edit (`editField`) and a structure op (`buildChangeSet`) - so a
 * document-derived form field (the CRE item-slot and selected-weapon dropdowns, whose options/values read
 * the Items list) refreshes after ANY mutation without each derived view registering itself as a dependent.
 * The layout field set is bounded and form-only (the big list/tree blocks are served separately by the
 * windowed getWindow/getChildren path), so resending it wholesale on every edit is cheap. This is the
 * correctness guarantee for derived form fields; `RelationshipModel.dependents` is the precise-by-id
 * complement that additionally covers list-block derived rows (effect params past the first entry, which are
 * not in this layout-field set). Returns [] for a format with no declarative layout.
 */
export function layoutFieldRows(session: EditorSession): Row[] {
    const layout = buildLayout(session.parserId, session.model, session.relationshipModel).layout;
    return layout ? Object.values(layout.fields) : [];
}

let counter = 0;
function nextId(): SessionId {
    counter += 1;
    return `s${counter}`;
}

function extOf(uri: string): string {
    // Derive the extension from the last path segment only: strip any query/fragment (game-resource URIs carry
    // the game dir in ?g=...) and any directory prefix, so a "." in the query or a parent dir can't leak in.
    const pathPart = uri.split(/[?#]/, 1)[0]!;
    const base = pathPart.slice(Math.max(pathPart.lastIndexOf("/"), pathPart.lastIndexOf("\\")) + 1);
    const dot = base.lastIndexOf(".");
    return dot === -1 ? "" : base.slice(dot + 1);
}

export function closeSession(id: SessionId): void {
    sessionStore.delete(id);
}

/**
 * Opens a parse session. `engine` is the IE engine key of the game the record came from, where the host knew
 * one: an effect opcode means what its engine says it means, and the bytes cannot tell you which. Omitted for a
 * file opened off disk, which falls back to the preferred reading.
 */
export function openSession(uri: string, bytes: Uint8Array, options: ParseOptions = {}, engine?: string): OpenResult {
    const ext = extOf(uri);
    const parser = parserRegistry.getByExtension(ext);
    if (!parser) {
        return {
            sessionId: "",
            format: "",
            formatName: "",
            layout: { formatId: "" },
            warnings: [],
            errors: [`No parser for extension ".${ext}"`],
            rootWindow: [],
        };
    }
    let parseResult: ParseResult;
    try {
        parseResult = parser.parse(bytes, options);
    } catch (error) {
        return {
            sessionId: "",
            format: parser.id,
            formatName: parser.name,
            layout: { formatId: parser.id },
            warnings: [],
            errors: [error instanceof Error ? error.message : String(error)],
            rootWindow: [],
        };
    }
    const model = buildModel(parseResult);
    const relationshipModel = getRelationshipModel(parser.id, engine);
    const session: EditorSession = {
        id: nextId(),
        uri,
        parserId: parser.id,
        parseOptions: options,
        model,
        relationshipModel,
        composeSummary: summaryComposerFor(parser.id),
        undo: [],
        redo: [],
        dirty: false,
    };
    sessionStore.set(session.id, session);
    return {
        sessionId: session.id,
        format: parser.id,
        formatName: parser.name,
        layout: buildLayout(parser.id, model, relationshipModel),
        warnings: parseResult.warnings ?? [],
        errors: parseResult.errors ?? [],
        rootWindow: getWindow(model, 0, DEFAULT_WINDOW, relationshipModel, session.composeSummary),
    };
}
