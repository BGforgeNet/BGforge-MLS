/**
 * Engine procedure hover documentation for the TSSL TypeScript plugin.
 * Loads doc text from the build-time generated engine-proc-docs.json
 * and provides a function to append it to QuickInfo results.
 */

import engineProcDocs from "@bgforge/shared/data/fallout-ssl-engine-proc-docs.json";

const docs: Readonly<Record<string, string>> = engineProcDocs;

interface SymbolDisplayPart {
    readonly text: string;
    readonly kind: string;
}

/**
 * Minimal QuickInfo shape -- only the fields we read/write.
 * Compatible with ts.QuickInfo without importing the full TS API.
 */
export interface QuickInfoLike {
    readonly documentation?: readonly SymbolDisplayPart[];
    readonly displayParts?: readonly SymbolDisplayPart[];
}

/**
 * Append engine procedure documentation to an existing QuickInfo result.
 * Returns the original info unchanged if the symbol is not an engine procedure
 * or has no documentation.
 */
export function appendEngineProcDoc<T extends QuickInfoLike>(
    info: T | undefined,
    displayParts: readonly SymbolDisplayPart[] | undefined,
): T | undefined {
    if (info === undefined || displayParts === undefined) {
        return info;
    }

    // Extract the symbol name from display parts (look for the function name part)
    const namePart = displayParts.find((p) => p.kind === "functionName" || p.kind === "localName");
    if (namePart === undefined) {
        return info;
    }

    const doc = docs[namePart.text];
    if (doc === undefined) {
        return info;
    }

    const docPart: SymbolDisplayPart = { text: doc, kind: "text" };

    return {
        ...info,
        documentation: [...(info.documentation ?? []), docPart],
    };
}
