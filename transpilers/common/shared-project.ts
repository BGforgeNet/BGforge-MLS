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
 */
import { Project } from "ts-morph";

let sharedProject: Project | undefined;

export function getSharedProject(): Project {
    if (!sharedProject) {
        sharedProject = new Project({ useInMemoryFileSystem: true });
    }
    return sharedProject;
}
