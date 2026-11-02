import { FALLOUT_SSL_STANZAS } from "@bgforge/shared/stanza-names.ts";

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

/**
 * An individual sfall function within a category. Its signature is `type` and `args`, called through
 * `sfall_funcN` when it has a `metarule`; `detail` replaces all three for what is not a call.
 */
export interface SfallFunction {
    readonly name: string;
    readonly detail?: string;
    readonly doc?: string;
    readonly opcode?: string | number;
    readonly unsafe?: boolean;
    readonly macro?: string;
    readonly metarule?: string;
    readonly args?: readonly SfallArg[];
    readonly type?: string;
    readonly deprecated?: boolean | string;
}

/** An argument as functions.yml declares it. */
export interface SfallArg {
    readonly name: string;
    readonly type: string;
    readonly doc?: string;
    /** Only on a metarule call: this argument, and every one after it, can be omitted. */
    readonly optional?: boolean;
    /** The value an omitted argument takes; it marks the argument optional too. */
    readonly default?: string;
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
    readonly deprecated?: boolean | string;
}

/** A function argument, as the data pipeline reads it */
export interface FalloutArg {
    readonly name: string;
    readonly type: string;
    readonly doc?: string;
    readonly default?: string;
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
