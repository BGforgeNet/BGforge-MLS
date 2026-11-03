/**
 * The type check the tssl CLI runs before it compiles a script.
 *
 * The compile itself never asks for a type: its program exists to resolve names, under options chosen for
 * that. So the check builds a program of its own from the tsconfig.json that includes the script - the mod's
 * own options - and reads only that script's diagnostics; errors in a mod's `.ts` modules
 * are `tsc`'s to report. One program per tsconfig serves every script it includes, since a program is
 * checked file by file on demand.
 */

import * as fs from "fs";
import * as path from "path";
import { Project, ts } from "ts-morph";
import { filterEngineProcedureDiagnostics } from "@bgforge/shared/tssl-diagnostics";
import { ScriptConfigs, scriptTypeError, type ScriptTypecheckResult } from "@bgforge/transpile/internal";
import { realEntryPath, shadowEntryPath, TSSL_COMPILER_OPTIONS } from "./program-model";

/** Lets a tsconfig's `include` match `.tssl` files, as the editor's TypeScript server does. */
const TSSL_FILE_EXTENSIONS: readonly ts.FileExtensionInfo[] = [
    { extension: ".tssl", isMixedContent: false, scriptKind: ts.ScriptKind.Deferred },
];

/** For a script no tsconfig.json includes: the compiler's own options, strict, as a fresh project gets. */
const DEFAULT_OPTIONS: ts.CompilerOptions = { ...TSSL_COMPILER_OPTIONS, strict: true, noEmit: true };

/**
 * Adds a script under its shadow `.tssl.ts` name, as the compile does: TypeScript does not take a root with an
 * extension it does not know, and relative imports resolve unchanged from beside the real file.
 */
function addScript(project: Project, script: string): void {
    project.createSourceFile(shadowEntryPath(script), fs.readFileSync(script, "utf-8"), { overwrite: true });
}

/**
 * Keeps one program per tsconfig across a run, so a directory of scripts pays for each config once. Built
 * through ts-morph, whose bundled TypeScript serves the standard library from memory rather than from disk.
 */
export class TsslTypechecker {
    private readonly configs = new ScriptConfigs(TSSL_FILE_EXTENSIONS);
    private readonly programs = new Map<string, ts.Program>();
    /** One project for every script no tsconfig includes, so the libraries parse once. */
    private fallback: Project | undefined;

    check(file: string): ScriptTypecheckResult {
        const script = path.resolve(file);
        const config = this.configs.including(script);
        const program = config === undefined ? this.fallbackProgram(script) : this.programFor(config);
        const source = program.getSourceFile(shadowEntryPath(script));
        if (source === undefined) throw new Error(`${script}: missing from its own type-check program`);

        const diagnostics = [
            ...(config === undefined ? [] : this.configs.parsed(config).errors),
            ...program.getOptionsDiagnostics(),
            ...program.getGlobalDiagnostics(),
            ...program.getSyntacticDiagnostics(source),
            ...program.getSemanticDiagnostics(source),
        ];
        return {
            config,
            errors: filterEngineProcedureDiagnostics(diagnostics).map((d) =>
                scriptTypeError(d, config ?? script, realEntryPath),
            ),
        };
    }

    private programFor(configPath: string): ts.Program {
        const cached = this.programs.get(configPath);
        if (cached) return cached;
        const parsed = this.configs.parsed(configPath);
        const project = new Project({ compilerOptions: { ...parsed.options, noEmit: true } });
        for (const name of parsed.fileNames) {
            if (name.endsWith(".tssl")) addScript(project, name);
            else project.addSourceFileAtPath(name);
        }
        const program = project.getProgram().compilerObject;
        this.programs.set(configPath, program);
        return program;
    }

    private fallbackProgram(script: string): ts.Program {
        this.fallback ??= new Project({ compilerOptions: DEFAULT_OPTIONS });
        addScript(this.fallback, script);
        return this.fallback.getProgram().compilerObject;
    }
}
