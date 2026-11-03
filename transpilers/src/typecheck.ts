/**
 * The type check the fgtp CLI runs before it transpiles a script.
 *
 * The transpilers never ask for a type: they read the syntax and resolve names for themselves. So a name no
 * declaration binds - a typo in an engine action - would reach the generated file as written. The check builds a
 * program from the tsconfig.json that includes the script, the mod's own options, and reads only that script's
 * diagnostics. Where the project holds `.td` scripts it also declares the TD runtime and applies the compiler
 * settings the editor's TD plugin applies, so the command line reports what the editor shows.
 */

import * as fs from "fs";
import * as path from "path";
import { Project, ts } from "ts-morph";
import { tdProjectSettings } from "@bgforge/shared/td-project-settings";
import { EXT_TBAF, EXT_TD } from "../common/extensions";
import { ScriptConfigs, scriptTypeError, type ScriptTypecheckResult } from "../common/script-typecheck";

/** Where the TD runtime declarations sit in a program: nowhere on disk, and never named in an error. */
const TD_RUNTIME_PATH = "/bgforge-td-runtime.d.ts";

let tdRuntimeSource: string | undefined;

/** The TD API declarations: beside the bundle in the published package (the build copies them), else in the TD sources. */
function readTdRuntime(): string {
    if (tdRuntimeSource === undefined) {
        const candidates = [
            path.join(import.meta.dirname, "td-runtime.d.ts"),
            path.join(import.meta.dirname, "../td/src/td-runtime.d.ts"),
        ];
        const found = candidates.find((candidate) => fs.existsSync(candidate));
        if (found === undefined) throw new Error(`TD runtime declarations not found in: ${candidates.join(", ")}`);
        tdRuntimeSource = fs.readFileSync(found, "utf-8");
    }
    return tdRuntimeSource;
}

/** Lets a tsconfig's `include` match the scripts. `Deferred` is the kind the config parser lists a non-TS extension under. */
const SCRIPT_EXTENSIONS: readonly ts.FileExtensionInfo[] = [EXT_TBAF, EXT_TD].map((extension) => ({
    extension,
    isMixedContent: false,
    scriptKind: ts.ScriptKind.Deferred,
}));

/**
 * For a script no tsconfig.json includes: strict, resolving packages through their `exports` as the transpilers'
 * bundler does. One library for both languages - the TD plugin's - so a script sees the same globals in either.
 */
const DEFAULT_OPTIONS: ts.CompilerOptions = {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    ...tdProjectSettings(ts.ScriptTarget),
    types: [],
    strict: true,
    noEmit: true,
};

// Case-insensitive, as the CLI's own dispatch is: `Dialog.TD` is a TD script.
function isScript(file: string): boolean {
    return SCRIPT_EXTENSIONS.some(({ extension }) => file.toLowerCase().endsWith(extension));
}

function isTd(file: string): boolean {
    return file.toLowerCase().endsWith(EXT_TD);
}

/**
 * The path a script is registered under: TypeScript does not take a root with an extension it does not know, and
 * relative imports resolve unchanged from beside the real file.
 */
function shadowPath(script: string): string {
    return `${script}.ts`;
}

/** The author's script for a shadow path, any other path unchanged. */
function authorsPath(file: string): string {
    return file.endsWith(".ts") && isScript(file.slice(0, -".ts".length)) ? file.slice(0, -".ts".length) : file;
}

function addScript(project: Project, script: string): void {
    project.createSourceFile(shadowPath(script), fs.readFileSync(script, "utf-8"), { overwrite: true });
}

/** A project for `scripts`: with the TD runtime and the TD plugin's settings if any of them is a .td. */
function newProject(options: ts.CompilerOptions, scripts: readonly string[]): Project {
    const holdsTd = scripts.some((script) => isTd(script));
    const project = new Project({
        compilerOptions: { ...options, ...(holdsTd ? tdProjectSettings(ts.ScriptTarget) : {}) },
    });
    if (holdsTd) project.createSourceFile(TD_RUNTIME_PATH, readTdRuntime(), { overwrite: true });
    return project;
}

/** The one script a project for unconfigured scripts holds at a time. */
interface Unconfigured {
    project: Project;
    held: string | undefined;
}

/**
 * Keeps one program per tsconfig across a run, so a directory of scripts pays for each config once. Built through
 * ts-morph, whose bundled TypeScript serves the standard library from memory rather than from disk.
 */
export class TranspilerTypechecker {
    private readonly configs = new ScriptConfigs(SCRIPT_EXTENSIONS);
    private readonly programs = new Map<string, ts.Program>();
    /** One project per language for the scripts no tsconfig includes, so the libraries parse once. */
    private readonly unconfigured = new Map<"td" | "tbaf", Unconfigured>();

    check(file: string): ScriptTypecheckResult {
        const script = path.resolve(file);
        const config = this.configs.including(script);
        const program = config === undefined ? this.unconfiguredProgram(script) : this.programFor(config);
        const source = program.getSourceFile(shadowPath(script));
        if (source === undefined) throw new Error(`${script}: missing from its own type-check program`);

        const diagnostics = [
            ...(config === undefined ? [] : this.configs.parsed(config).errors),
            ...program.getOptionsDiagnostics(),
            ...program.getGlobalDiagnostics(),
            ...program.getSyntacticDiagnostics(source),
            ...program.getSemanticDiagnostics(source),
        ];
        return { config, errors: diagnostics.map((d) => scriptTypeError(d, config ?? script, authorsPath)) };
    }

    private programFor(configPath: string): ts.Program {
        const cached = this.programs.get(configPath);
        if (cached) return cached;
        const parsed = this.configs.parsed(configPath);
        const project = newProject({ ...parsed.options, noEmit: true }, parsed.fileNames);
        for (const name of parsed.fileNames) {
            if (isScript(name)) addScript(project, name);
            else project.addSourceFileAtPath(name);
        }
        const program = project.getProgram().compilerObject;
        this.programs.set(configPath, program);
        return program;
    }

    /**
     * Holds the script alone: declarations in one script are not another's to clash with, as they are not in the
     * editor, where a script no tsconfig includes is checked by itself.
     */
    private unconfiguredProgram(script: string): ts.Program {
        const kind = isTd(script) ? "td" : "tbaf";
        let entry = this.unconfigured.get(kind);
        if (entry === undefined) {
            entry = { project: newProject(DEFAULT_OPTIONS, [script]), held: undefined };
            this.unconfigured.set(kind, entry);
        }
        if (entry.held !== undefined) entry.project.getSourceFile(shadowPath(entry.held))?.forget();
        addScript(entry.project, script);
        entry.held = script;
        return entry.project.getProgram().compilerObject;
    }
}
