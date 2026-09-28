import type { FunctionInfo } from "./header-parser";
import { localFunctions } from "./request-caches";

/** A function or macro the document defines, by name; `version` lets a repeat ask reuse the last walk. */
export function findLocalCallableDefinition(
    text: string,
    uri: string,
    name: string,
    version?: number,
): FunctionInfo | null {
    return localFunctions(uri, version, text).find((func) => func.name === name) ?? null;
}
