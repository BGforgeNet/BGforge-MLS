/**
 * Canonical YAML stanza/category identifiers shared across build-time scripts
 * and runtime code. Keep stringly-typed stanza names here instead of spreading
 * them through generators, loaders, and updater scripts.
 *
 * Sync note:
 * - TP2 stanza-backed completion categories are consumed from here by
 *   server/src/shared/completion-context.ts.
 * - TP2 categories such as "action", "patch", and "vars" are stanza names too -
 *   an item's category defaults to its stanza - but they stay local to
 *   completion-context.ts, since no build-time script needs them.
 */

export const FALLOUT_SSL_STANZAS = {
    base_functions: "base_functions",
    engine_procedures: "engine_procedures",
    hooks: "hooks",
    key_functions: "key_functions",
    movie_functions: "movie_functions",
    preprocessor_directives: "preprocessor_directives",
    say_functions: "say_functions",
    sfall_functions: "sfall_functions",
    sound_functions: "sound_functions",
    window_functions: "window_functions",
} as const;

export const FALLOUT_SSL_BUILTIN_FUNCTION_STANZAS = [
    FALLOUT_SSL_STANZAS.base_functions,
    FALLOUT_SSL_STANZAS.key_functions,
    FALLOUT_SSL_STANZAS.movie_functions,
    FALLOUT_SSL_STANZAS.say_functions,
    FALLOUT_SSL_STANZAS.sound_functions,
    FALLOUT_SSL_STANZAS.window_functions,
] as const;

export const WEIDU_TP2_STANZAS = {
    action_functions: "action_functions",
    action_macros: "action_macros",
    array_sort_type: "array_sort_type",
    component: "component",
    component_flag: "component_flag",
    dimorphic_functions: "dimorphic_functions",
    func_var_keyword: "func_var_keyword",
    opt_case: "opt_case",
    opt_exact: "opt_exact",
    opt_glob: "opt_glob",
    patch_functions: "patch_functions",
    patch_macros: "patch_macros",
} as const;

export const WEIDU_TP2_CALLABLE_PREFIX: Record<string, string> = {
    [WEIDU_TP2_STANZAS.action_functions]: "action function ",
    [WEIDU_TP2_STANZAS.patch_functions]: "patch function ",
    [WEIDU_TP2_STANZAS.dimorphic_functions]: "dimorphic function ",
    [WEIDU_TP2_STANZAS.action_macros]: "action macro ",
    [WEIDU_TP2_STANZAS.patch_macros]: "patch macro ",
};
