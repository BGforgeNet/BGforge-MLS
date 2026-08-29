/**
 * Module-scoped ts-morph Project shared across transpiler passes.
 *
 * ts-morph Project construction is a hot allocation. Callers that need a
 * lightweight, short-lived source file reuse this project with
 * `createSourceFile(path, text, { overwrite: true })` so each call replaces
 * the previous virtual file at the same path.
 *
 * Different callers MUST use distinct virtual paths to avoid stepping on
 * each other's source files between turns of the event loop. Convention:
 * `<caller-tag>.ts`, e.g. "enum-transform.ts", "tbaf-expr.ts".
 *
 * No lib files are loaded. Every caller here asks only for syntactic answers - an AST walk or
 * `getSyntacticDiagnostics` - and none reaches the type checker, so the declarations the default
 * `lib.es2022.full.d.ts` would bind are never consulted. Loading them anyway cost 356 ms of the
 * first parse against 31 ms without, and 76 MB of resident heap; on the server that first parse
 * runs on the thread answering hover and completion. `TSSL_COMPILER_OPTIONS` pins the same default
 * away for the compile path, which does need types - see its rationale for the measurement there.
 */
import { Project } from "ts-morph";

let sharedProject: Project | undefined;

export function getSharedProject(): Project {
    if (!sharedProject) {
        sharedProject = new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true });
    }
    return sharedProject;
}
