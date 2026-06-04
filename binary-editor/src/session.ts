import { parserRegistry, type ParseOptions, type ParseResult } from "@bgforge/binary";
import { buildLayout } from "./layout";
import { buildModel, type Model } from "./model";
import { getRelationshipModel } from "./relationship/registry";
import type { RelationshipModel } from "./relationship/types";
import { getWindow } from "./window";
import type { OpenResult, SessionId } from "./types";

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
    undo: UndoEntry[];
    redo: UndoEntry[];
    dirty: boolean;
}

export const sessionStore = new Map<SessionId, EditorSession>();

let counter = 0;
function nextId(): SessionId {
    counter += 1;
    return `s${counter}`;
}

function extOf(uri: string): string {
    const dot = uri.lastIndexOf(".");
    return dot === -1 ? "" : uri.slice(dot + 1);
}

export function closeSession(id: SessionId): void {
    sessionStore.delete(id);
}

export function openSession(uri: string, bytes: Uint8Array, options: ParseOptions = {}): OpenResult {
    const ext = extOf(uri);
    const parser = parserRegistry.getByExtension(ext);
    if (!parser) {
        return {
            sessionId: "",
            format: "",
            formatName: "",
            layout: { formatId: "", sections: [] },
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
            layout: { formatId: parser.id, sections: [] },
            warnings: [],
            errors: [error instanceof Error ? error.message : String(error)],
            rootWindow: [],
        };
    }
    const model = buildModel(parseResult);
    const relationshipModel = getRelationshipModel(parser.id);
    const session: EditorSession = {
        id: nextId(),
        uri,
        parserId: parser.id,
        parseOptions: options,
        model,
        relationshipModel,
        undo: [],
        redo: [],
        dirty: false,
    };
    sessionStore.set(session.id, session);
    return {
        sessionId: session.id,
        format: parser.id,
        formatName: parser.name,
        layout: buildLayout(parser.id, model),
        warnings: parseResult.warnings ?? [],
        errors: parseResult.errors ?? [],
        rootWindow: getWindow(model, 0, 200, relationshipModel),
    };
}
