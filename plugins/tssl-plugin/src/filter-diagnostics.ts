/**
 * Pure diagnostic filtering for the TSSL TypeScript plugin.
 * Filters out TS6133 ("declared but never read") for Fallout engine
 * procedure names in .tssl files.
 */

// Generated from server/data/fallout-ssl-base.yml by generate-data.sh.
// Inlined by esbuild at bundle time.
import engineProcedureNames from "../../../server/out/fallout-ssl-engine-procedures.json";

const ENGINE_PROCEDURES: ReadonlySet<string> = new Set(engineProcedureNames);

/** TS6133: '{0}' is declared but its value is never read. */
const TS6133_CODE = 6133;

/**
 * Matches the quoted identifier in a TS6133 message: 'name' or "name".
 * The pattern depends on TypeScript's diagnostic message wording, which is
 * stable across the 5.x line but unversioned in the public API. If a future
 * TypeScript major rephrases TS6133, the procedure-name suppression below
 * will silently stop working — guard with a snapshot test on a fixed TS
 * version before bumping the `typescript` dep range.
 */
const TS6133_IDENTIFIER_RE = /^['"](\w+)['"]\s+is declared but/;

/**
 * Diagnostic shape compatible with TypeScript's ts.Diagnostic.
 * Only the fields we inspect are required.
 */
export interface DiagnosticLike {
    readonly code: number;
    readonly messageText: string | { readonly messageText: string };
}

/**
 * Extract the identifier name from a TS6133 diagnostic message.
 * Handles both plain string and DiagnosticMessageChain shapes.
 * @returns The identifier name, or undefined if the message doesn't match.
 */
export function extractIdentifierFromTS6133(
    messageText: string | { readonly messageText: string },
): string | undefined {
    const text = typeof messageText === "string" ? messageText : messageText.messageText;
    const match = TS6133_IDENTIFIER_RE.exec(text);
    return match?.[1];
}

/**
 * Filter out TS6133 diagnostics for Fallout engine procedure names.
 * Returns a new array (immutable -- does not modify the input).
 */
export function filterEngineProcedureDiagnostics<T extends DiagnosticLike>(diagnostics: readonly T[]): T[] {
    return diagnostics.filter((d) => {
        if (d.code !== TS6133_CODE) {
            return true;
        }
        const identifier = extractIdentifierFromTS6133(d.messageText);
        return identifier === undefined || !ENGINE_PROCEDURES.has(identifier);
    });
}
