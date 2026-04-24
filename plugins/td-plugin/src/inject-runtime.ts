/**
 * TD runtime injection and host overrides for the TD TypeScript plugin.
 * Resolves the td-runtime.d.ts path, injects it into the project file list,
 * overrides compilation settings to exclude DOM types, and provides
 * TD runtime name extraction for completion filtering.
 */

import type ts from "typescript";
import * as path from "path";
import * as fs from "fs";

/** Result of resolving the runtime file path. */
interface RuntimeResolution {
    readonly path: string;
    readonly exists: boolean;
}

/**
 * Resolve the td-runtime.d.ts file path.
 * Checks both VSIX and npm package locations.
 */
export function resolveRuntimePath(): RuntimeResolution {
    // When installed as npm package: node_modules/@bgforge/td-plugin/out/index.js
    // td-runtime.d.ts is in node_modules/@bgforge/mls-server/out/td-runtime.d.ts
    // When bundled in VSIX: node_modules/bgforge-td-plugin/index.js
    // td-runtime.d.ts is at ../../server/out/td-runtime.d.ts
    // Try both locations.
    const vsixPath = path.resolve(__dirname, "../../server/out/td-runtime.d.ts");
    const npmPath = path.resolve(__dirname, "../../@bgforge/mls-server/out/td-runtime.d.ts");
    if (fs.existsSync(vsixPath)) {
        return { path: vsixPath, exists: true };
    }
    if (fs.existsSync(npmPath)) {
        return { path: npmPath, exists: true };
    }
    return { path: vsixPath, exists: false };
}

/**
 * Extract all declared identifier names from source text.
 * Matches both explicit (`declare function X`) and implicit (`interface X`,
 * `type X`) declarations. Anchored to line start to skip JSDoc comment text.
 */
function extractDeclaredNames(content: string): ReadonlySet<string> {
    const names = new Set<string>();
    const re = /^[ \t]*(?:declare\s+)?(?:function|interface|type|var|const|let|class|enum)\s+(\w+)/gm;
    let match;
    while ((match = re.exec(content)) !== null) {
        const name = match[1];
        if (name !== undefined) names.add(name);
    }
    return names;
}

/**
 * Load TD runtime names from the resolved runtime file.
 * Returns the set of declared names, or an empty set on error.
 */
export function loadTdNames(runtimePath: string): ReadonlySet<string> {
    try {
        const content = fs.readFileSync(runtimePath, "utf-8");
        return extractDeclaredNames(content);
    } catch {
        return new Set();
    }
}

/**
 * Check whether a file name has the .td extension.
 */
export function isTdFile(fileName: string): boolean {
    return fileName.endsWith(".td");
}

/**
 * Override the language service host to inject td-runtime.d.ts and
 * exclude DOM lib for projects containing .td files.
 */
export function overrideHost(host: ts.LanguageServiceHost, resolvedPath: string, tsModule: typeof ts): void {
    // Inject td-runtime.d.ts into the project's file list.
    // getExternalFiles does not reliably add files to inferred projects.
    const originalGetScriptFileNames = host.getScriptFileNames.bind(host);
    host.getScriptFileNames = () => {
        const files: string[] = originalGetScriptFileNames();
        if (!files.some((f: string) => isTdFile(f))) return files;
        if (files.includes(resolvedPath)) return files;
        return [...files, resolvedPath];
    };

    // Exclude DOM lib for projects containing .td files to avoid unrelated
    // completions (RemotePlayback, XMLHttpRequestUpload, etc.).
    // Without a tsconfig, TypeScript loads the default lib which includes DOM.
    const originalGetCompilationSettings = host.getCompilationSettings.bind(host);
    host.getCompilationSettings = () => {
        const settings = originalGetCompilationSettings();
        // Use current host method (not stale pre-override reference) so that
        // files added by other plugins or tsserver updates are seen.
        const allFiles: string[] = host.getScriptFileNames();
        if (!allFiles.some((f: string) => isTdFile(f))) {
            return settings;
        }
        return {
            ...settings,
            target: tsModule.ScriptTarget.ES2020,
            lib: ["lib.es2020.d.ts"],
        };
    };
}
