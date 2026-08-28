import type { CompileResult } from "svelte/compiler";

/** esbuild-svelte `filterWarnings` predicate dropping warnings raised inside third-party `.svelte` sources. */
export declare const dropThirdPartyWarnings: (warning: CompileResult["warnings"][number]) => boolean;
