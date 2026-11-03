/**
 * What the CLIs' pre-compile type checks share, whatever the script language: which tsconfig.json governs a script,
 * the error shape they report, and how it prints. A check's program differs per language (its extension, its
 * ambient declarations, its option overrides), so building one stays with each checker.
 */

import * as path from "path";
import { ts } from "ts-morph";

/** One error, in the file the author edits; a position only when TypeScript gives one. */
export interface ScriptTypeError {
    file: string;
    /** 1-based. */
    line?: number;
    /** 1-based. */
    column?: number;
    code: number;
    message: string;
}

export interface ScriptTypecheckResult {
    /** The tsconfig.json the script was checked with, or undefined for the strict defaults. */
    config: string | undefined;
    errors: ScriptTypeError[];
}

/** `file:line:col: error TS1234: message`, the shape editors' problem matchers read. */
export function formatTypeError(error: ScriptTypeError): string {
    const position = error.line === undefined ? "" : `:${error.line}:${error.column ?? 1}`;
    return `${error.file}${position}: error TS${error.code}: ${error.message}`;
}

/**
 * A diagnostic as the author reads it. `authorsPath` maps the path the checker saw to the author's file; a
 * diagnostic with no position is attributed to `fallbackFile`.
 */
export function scriptTypeError(
    diagnostic: ts.Diagnostic,
    fallbackFile: string,
    authorsPath: (file: string) => string,
): ScriptTypeError {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    if (diagnostic.file === undefined || diagnostic.start === undefined) {
        return { file: fallbackFile, code: diagnostic.code, message };
    }
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return {
        file: path.resolve(authorsPath(diagnostic.file.fileName)),
        line: line + 1,
        column: character + 1,
        code: diagnostic.code,
        message,
    };
}

/** Finds, and keeps parsed, the tsconfig.json files that govern scripts of one language. */
export class ScriptConfigs {
    private readonly configs = new Map<string, ts.ParsedCommandLine>();
    private readonly extensions: readonly ts.FileExtensionInfo[];

    /**
     * `extensions` lets a tsconfig's `include` match the scripts, as the editor's TypeScript server does; use the
     * `Deferred` script kind, which the config parser lists a non-TypeScript extension under (any other leaves the
     * files out).
     */
    constructor(extensions: readonly ts.FileExtensionInfo[]) {
        this.extensions = extensions;
    }

    /** The tsconfig.json at `configPath`, parsed once; an unreadable one throws, naming the file. */
    parsed(configPath: string): ts.ParsedCommandLine {
        let parsed = this.configs.get(configPath);
        if (parsed === undefined) {
            parsed = this.parse(configPath);
            this.configs.set(configPath, parsed);
        }
        return parsed;
    }

    /**
     * The nearest tsconfig.json that includes the script. A nearer one that does not - a repository's root
     * config listing its tool files, say - is passed over for the next one up, never applied to the script.
     */
    including(script: string): string | undefined {
        let dir = path.dirname(script);
        for (;;) {
            const found = ts.findConfigFile(dir, ts.sys.fileExists);
            if (found === undefined) return undefined;
            const configPath = path.resolve(found);
            if (this.parsed(configPath).fileNames.some((name) => path.resolve(name) === script)) return configPath;
            const parent = path.dirname(path.dirname(configPath));
            if (parent === path.dirname(configPath)) return undefined;
            dir = parent;
        }
    }

    private parse(configPath: string): ts.ParsedCommandLine {
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
            this.extensions,
        );
        if (parsed === undefined) throw new Error(`${configPath}: cannot be read`);
        return parsed;
    }
}
