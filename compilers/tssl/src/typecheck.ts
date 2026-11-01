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
import { realEntryPath, shadowEntryPath, TSSL_COMPILER_OPTIONS } from "./program-model";

/** One error, in the file the author edits; a position only when TypeScript gives one. */
export interface TsslTypeError {
    file: string;
    /** 1-based. */
    line?: number;
    /** 1-based. */
    column?: number;
    code: number;
    message: string;
}

export interface TsslTypecheckResult {
    /** The tsconfig.json the script was checked with, or undefined for the strict defaults. */
    config: string | undefined;
    errors: TsslTypeError[];
}

/**
 * Lets a tsconfig's `include` match `.tssl` files, as the editor's TypeScript server does. `Deferred` is the
 * kind the config parser lists a non-TypeScript extension under; any other kind leaves the files out.
 */
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

function parseConfig(configPath: string): ts.ParsedCommandLine {
    const parsed = ts.getParsedCommandLineOfConfigFile(
        configPath,
        undefined,
        {
            ...ts.sys,
            onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
                throw new Error(`${configPath}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`);
            },
        },
        undefined,
        undefined,
        TSSL_FILE_EXTENSIONS,
    );
    if (parsed === undefined) throw new Error(`${configPath}: cannot be read`);
    return parsed;
}

function toError(diagnostic: ts.Diagnostic, fallbackFile: string): TsslTypeError {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    if (diagnostic.file === undefined || diagnostic.start === undefined) {
        return { file: fallbackFile, code: diagnostic.code, message };
    }
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return {
        file: path.resolve(realEntryPath(diagnostic.file.fileName)),
        line: line + 1,
        column: character + 1,
        code: diagnostic.code,
        message,
    };
}

/**
 * Keeps one program per tsconfig across a run, so a directory of scripts pays for each config once. Built
 * through ts-morph, whose bundled TypeScript serves the standard library from memory rather than from disk.
 */
export class TsslTypechecker {
    private readonly configs = new Map<string, ts.ParsedCommandLine>();
    private readonly programs = new Map<string, ts.Program>();
    /** One project for every script no tsconfig includes, so the libraries parse once. */
    private fallback: Project | undefined;

    check(file: string): TsslTypecheckResult {
        const script = path.resolve(file);
        const config = this.configIncluding(script);
        const program = config === undefined ? this.fallbackProgram(script) : this.programFor(config);
        const source = program.getSourceFile(shadowEntryPath(script));
        if (source === undefined) throw new Error(`${script}: missing from its own type-check program`);

        const diagnostics = [
            ...(config === undefined ? [] : (this.configs.get(config)?.errors ?? [])),
            ...program.getOptionsDiagnostics(),
            ...program.getGlobalDiagnostics(),
            ...program.getSyntacticDiagnostics(source),
            ...program.getSemanticDiagnostics(source),
        ];
        return {
            config,
            errors: filterEngineProcedureDiagnostics(diagnostics).map((d) => toError(d, config ?? script)),
        };
    }

    /**
     * The nearest tsconfig.json that includes the script. A nearer one that does not - a repository's root
     * config listing its tool files, say - is passed over for the next one up, never applied to the script.
     */
    private configIncluding(script: string): string | undefined {
        let dir = path.dirname(script);
        for (;;) {
            const found = ts.findConfigFile(dir, ts.sys.fileExists);
            if (found === undefined) return undefined;
            const configPath = path.resolve(found);
            let parsed = this.configs.get(configPath);
            if (parsed === undefined) {
                parsed = parseConfig(configPath);
                this.configs.set(configPath, parsed);
            }
            if (parsed.fileNames.some((name) => path.resolve(name) === script)) return configPath;
            const parent = path.dirname(path.dirname(configPath));
            if (parent === path.dirname(configPath)) return undefined;
            dir = parent;
        }
    }

    private programFor(configPath: string): ts.Program {
        const cached = this.programs.get(configPath);
        if (cached) return cached;
        const parsed = this.configs.get(configPath);
        if (parsed === undefined) throw new Error(`${configPath}: checked before it was parsed`);
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
