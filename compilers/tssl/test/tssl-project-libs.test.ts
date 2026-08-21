/**
 * What the compiler's TypeScript project loads before it has read a single script.
 *
 * `TSSL_COMPILER_OPTIONS` pins `lib` to the language core. The default for its target would add DOM,
 * WebWorker and ScriptHost, which a script running inside a game engine cannot reach - and their
 * declarations are the bulk of what a first compile spends its time parsing and binding. Nothing else
 * fails if that pin is dropped: every script still compiles to the same bytes, only slower and heavier,
 * which is what this is here to notice.
 */
import { describe, expect, it } from "vitest";
import { createBatchState } from "../src/batch";

/** Total size of the declaration files TypeScript loads on its own, in MB. */
function libDeclarationSize(): number {
    const project = createBatchState().project;
    project.createSourceFile("/virtual/probe.ts", "export const probe = 1;\n", { overwrite: true });
    const loaded = project.getProgram().compilerObject.getSourceFiles();
    const libs = loaded.filter((file) => file.fileName.includes("/typescript/lib/"));
    return libs.reduce((total, file) => total + file.text.length, 0) / 1048576;
}

describe("the project the compiler stands up", () => {
    // Measured at the time of writing: 0.11 MB pinned, against 1.70 MB with the default lib set. The
    // bound sits far enough above the first to survive a TypeScript upgrade and far enough below the
    // second to fail the moment the pin goes.
    it("loads only the core language declarations, not the host environments", () => {
        expect(libDeclarationSize()).toBeLessThan(0.5);
    });
});
