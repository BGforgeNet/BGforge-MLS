/**
 * The shared ts-morph project loads no lib files (transpilers/common/shared-project.ts).
 *
 * Nothing reaching this project consults the type checker, so binding the default
 * `lib.es2022.full.d.ts` buys nothing and costs 356 ms of the first parse against 31 ms without it -
 * paid, on the server, by the thread that answers hover and completion. Restoring the default is
 * invisible at every call site and turns no test red on its own, which is what this guard is for.
 *
 * The second case is the other half: it pins the assumption the first one rests on, so a caller that
 * later does need types fails here rather than silently reading `any` off an unresolved global.
 */
import { describe, expect, it } from "vitest";
import { getSharedProject } from "../common/shared-project";

const LIB_FILE = /lib\.[^/]*\.d\.ts$/;

// ts-morph is not a declared dependency of this package, so the type comes from the accessor rather
// than from an import the test could not resolve.
type SharedProject = ReturnType<typeof getSharedProject>;

function libFilesOf(project: SharedProject): string[] {
    return project
        .getProgram()
        .compilerObject.getSourceFiles()
        .map((sf) => sf.fileName)
        .filter((name) => LIB_FILE.test(name));
}

describe("shared ts-morph project", () => {
    it("binds no lib declaration files", () => {
        const project = getSharedProject();
        project.createSourceFile("shared-project.test.ts", "export const a = [1, 2].map((n) => n + 1);", {
            overwrite: true,
        });

        expect(libFilesOf(project)).toEqual([]);
    });

    it("still answers syntactic queries, which is all its callers ask for", () => {
        const project = getSharedProject();
        const sf = project.createSourceFile(
            "shared-project.test.ts",
            "export function f(): void {\n    for (const n of [1, 2]) void n;\n}\n",
            { overwrite: true },
        );

        expect(project.getProgram().getSyntacticDiagnostics(sf)).toEqual([]);
        expect(sf.getFunctions()).toHaveLength(1);
    });
});
