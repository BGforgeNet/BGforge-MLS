export const ScopeKind = {
    File: "file",
    Function: "function",
    Loop: "loop",
} as const;

export type ScopeKind = (typeof ScopeKind)[keyof typeof ScopeKind];
