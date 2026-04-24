import { parseHeader, type FunctionInfo } from "./header-parser";

export function findLocalCallableDefinition(text: string, uri: string, name: string): FunctionInfo | null {
    const functions = parseHeader(text, uri);
    return functions.find((func) => func.name === name) ?? null;
}
