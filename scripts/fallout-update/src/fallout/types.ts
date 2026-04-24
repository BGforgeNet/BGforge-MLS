import { FALLOUT_SSL_STANZAS } from "../../../../shared/stanza-names.ts";

/**
 * Type definitions for Fallout sfall data structures.
 * Used when parsing sfall's functions.yml and hooks.yml, and when
 * generating completion and highlight YAML files.
 */

/** A category of sfall functions as parsed from functions.yml */
export interface SfallCategory {
    readonly name: string;
    readonly parent?: string;
    readonly doc?: string;
    readonly items?: readonly SfallFunction[];
}

/** An individual sfall function within a category */
export interface SfallFunction {
    readonly name: string;
    readonly detail: string;
    readonly doc?: string;
    readonly opcode?: string | number;
    readonly unsafe?: boolean;
    readonly macro?: string;
    readonly args?: readonly FalloutArg[];
    readonly type?: string;
}

/** A hook entry from hooks.yml */
export interface SfallHook {
    readonly name: string;
    readonly id?: string;
    readonly doc: string;
    readonly filename?: string;
}

/** Completion item for the sfall YAML output */
export interface FalloutCompletionItem {
    readonly name: string;
    readonly detail?: string;
    readonly doc?: string;
    readonly args?: readonly FalloutArg[];
    readonly type?: string;
}

/** A function argument */
export interface FalloutArg {
    readonly name: string;
    readonly type: string;
    readonly doc: string;
}

/** Completion type constants matching the LSP extension's type enum */
export const COMPLETION_TYPE_FUNCTION = 3;
export const COMPLETION_TYPE_CONSTANT = 21;

/** Stanza names in the completion YAML */
export const SFALL_FUNCTIONS_STANZA = FALLOUT_SSL_STANZAS.sfall_functions;
export const SFALL_HOOKS_STANZA = FALLOUT_SSL_STANZAS.hooks;

/** Repository stanza names in the highlight YAML */
export const HIGHLIGHT_STANZAS = {
    falloutBaseFunctions: "fallout-base-functions",
    sfallFunctions: "sfall-functions",
    hooks: FALLOUT_SSL_STANZAS.hooks,
} as const;
