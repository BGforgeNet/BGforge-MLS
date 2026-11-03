/**
 * In-repo entry point: the transpiler plumbing the BGforge MLS server and the TSSL compiler build on -
 * the shared pipeline, line provenance, the error type, and the shared parse project.
 *
 * Nothing here carries a semver promise - these move whenever the transpilers do. Anything an outside
 * consumer of @bgforge/transpile should be able to call belongs in index.ts instead. Helpers used only
 * within this package belong in neither: siblings import those from the defining module.
 */

// Errors and line provenance
export { TranspileError } from "../common/transpile-error";
export type { SourcePosition } from "../common/line-map";
export { TrackedText, joinTracked, type TrackedChunk, type EmittedText } from "../common/tracked-text";

// The shared pipeline and the generated-file header every transpiler writes
export { createTranspiler, type TranspilerEvent } from "../common/transpiler-pipeline";
export { makeGeneratedHeader } from "../common/transpiler-utils";
export { outputPathFor } from "../common/output-path";

// What the CLIs' pre-compile type checks share: the governing tsconfig.json and the error a script gets
export {
    ScriptConfigs,
    scriptTypeError,
    formatTypeError,
    type ScriptTypeError,
    type ScriptTypecheckResult,
} from "../common/script-typecheck";

// The parse project short-lived syntactic reads share
export { getSharedProject } from "../common/shared-project";

// TD's warning shape, carried across the server's worker boundary
export type { TDWarning } from "../td/src/types";
