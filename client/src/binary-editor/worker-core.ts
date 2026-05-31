import path from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch, type Request, type Response } from "@bgforge/binary-editor";
import { buildFileDerivedParseOptions, type ParseOptions } from "@bgforge/binary";

export interface WorkerRequest {
    id: number;
    request: Request;
}
export interface WorkerResponse {
    id: number;
    response: Response;
}

/** Parse options for opening a file in the editor. Mirrors the editor's historical
 *  builder: for maps, skipMapTiles avoids materializing ~40k tile fields (the cause of
 *  the old full-tree hang); the sibling-proto pidResolver is carried through when present.
 *  Non-map formats need no special options. Never throws (proto-dir scan is best-effort). */
export function deriveParseOptions(fsPath: string): ParseOptions | undefined {
    if (path.extname(fsPath).toLowerCase() !== ".map") return undefined;
    let fileDerived: ParseOptions | undefined;
    try {
        fileDerived = buildFileDerivedParseOptions(fsPath);
    } catch {
        fileDerived = undefined;
    }
    return { skipMapTiles: true, ...(fileDerived?.pidResolver ? { pidResolver: fileDerived.pidResolver } : {}) };
}

/** Processes one core Request and returns its Response. For `open`, parse options
 *  (including the pidResolver - a function that cannot cross the worker boundary)
 *  are derived here from the file path and injected, so the host ships only {uri, bytes}. */
export function createWorkerHandler(): (request: Request) => Response {
    return (request) => {
        if (request.type === "open") {
            const fsPath = toFsPath(request.uri);
            const options = fsPath ? deriveParseOptions(fsPath) : undefined;
            return dispatch({ ...request, options });
        }
        return dispatch(request);
    };
}

function toFsPath(uri: string): string | undefined {
    try {
        return uri.startsWith("file:") ? fileURLToPath(uri) : uri;
    } catch {
        return undefined;
    }
}
