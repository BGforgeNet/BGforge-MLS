/**
 * Per-document walks that hover, go-to-definition and completion need on every request: the local functions
 * and the deep-scoped variables. Each walks the whole tree - tens of milliseconds on a large installer - so
 * they are cached by document version, as the local symbols are. An unknown version bypasses the cache.
 */

import { TextCache } from "../shared/text-cache";
import { localCompletion } from "./ast-utils";
import type { Tp2CompletionItem } from "./completion/types";
import { parseHeader, type FunctionInfo } from "./header-parser";

const functions = new TextCache<FunctionInfo[]>();
const variables = new TextCache<Tp2CompletionItem[]>();

/** The functions and macros the document itself defines. */
export function localFunctions(uri: string, version: number | undefined, text: string): FunctionInfo[] {
    return functions.getOrParse(uri, version, text, (t) => parseHeader(t, uri)) ?? [];
}

/** Every variable the document declares, at any depth. */
export function localVariables(uri: string, version: number | undefined, text: string): Tp2CompletionItem[] {
    return variables.getOrParse(uri, version, text, (t) => localCompletion(t)) ?? [];
}

/** Drop a closed document's entries, as the local symbols' cache does. */
export function clearRequestCaches(uri: string): void {
    functions.clear(uri);
    variables.clear(uri);
}
