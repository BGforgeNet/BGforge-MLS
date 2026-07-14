/**
 * Engine-specific stubs for the TSSL transpiler golden samples.
 * These declarations exist only for typecheck-samples.sh validation - they let `tsc` resolve the
 * engine builtins the samples call. In production these come from folib and the per-project
 * generated engine typings; the transpiler itself treats any unresolved identifier as an external
 * engine call, so no import is needed for transpilation. Mirrors the sibling td-engine-stubs.d.ts.
 */

declare function debug_msg(msg: string): void;
declare function display_msg(msg: string): void;
declare function game_loaded(): number;
