export const ScopeKind = {
    File: "file",
    Procedure: "procedure",
    Macro: "macro",
    External: "external",
} as const;

export type ScopeKind = (typeof ScopeKind)[keyof typeof ScopeKind];

/**
 * Exhaustive-check helper for ScopeKind switches.
 * If a new ScopeKind variant is added, any switch that calls this in its default
 * branch will cause a TypeScript compile error, forcing the developer to handle it.
 *
 * Usage:
 *   switch (scope) {
 *     case ScopeKind.File: ...
 *     case ScopeKind.Procedure: ...
 *     default: return assertNeverScope(scope);
 *   }
 */
export function assertNeverScope(scope: never): never {
    throw new Error(`Unhandled ScopeKind: ${String(scope)}`);
}
