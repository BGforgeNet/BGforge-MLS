/**
 * Shared esbuild utilities for TSSL and TBAF transpilers.
 * Provides common initialization, output cleanup, reusable plugins,
 * and a shared bundler function.
 */

import * as fs from "fs";
import * as path from "path";
import * as esbuild from "esbuild-wasm";
import {
    collectDeclareEnums,
    resolveDtsPath,
    transformEnums,
    expandEnumPropertyAccess,
    enumTransformPlugin,
} from "./enum-transform";

let esbuildInitialized = false;

/**
 * Initialize esbuild (singleton, safe to call multiple times).
 * Native esbuild (used by CLI via alias) doesn't need initialize().
 * esbuild-wasm (used by LSP server) requires it.
 */
async function ensureEsbuild(): Promise<void> {
    if (esbuildInitialized) return;
    if (typeof esbuild.initialize === "function") {
        await esbuild.initialize({});
    }
    esbuildInitialized = true;
}

/** Configuration for the shared bundler. */
interface BundleConfig {
    /** Absolute path to the source file */
    readonly filePath: string;
    /** Source text content */
    readonly sourceText: string;
    /**
     * Pre-computed enum names from the source text.
     * When provided, skips the internal transformEnums() call on sourceText
     * (caller already transformed it and needs the result for other purposes).
     * sourceText should already be enum-transformed in this case.
     */
    readonly preTransformed?: { readonly enumNames: ReadonlySet<string> };
    /** Marker string prepended to source for stripping esbuild runtime helpers */
    readonly marker: string;
    /** esbuild target (e.g., "esnext", "es2022") */
    readonly target: string;
    /** Extra code appended after the source (e.g., preserve-function stubs) */
    readonly appendCode?: string;
    /** Value for esbuild stdin.sourcefile. Defaults to realPath. */
    readonly sourcefile?: string;
    /** Whether to request metafile from esbuild (for input file list) */
    readonly metafile?: boolean;
    /**
     * Additional esbuild plugins inserted before the shared enum/tree-shaking plugins.
     * If these plugins accumulate enum names, pass the same sets via
     * sharedEnumNames/sharedExternalEnumNames so all plugins share state.
     */
    readonly extraPlugins?: esbuild.Plugin[];
    /** Original constants for restoring esbuild-renamed identifiers in cleanup */
    readonly originalConstants?: Map<string, string>;
    /**
     * Mutable set for extra plugins to add enum names into.
     * Merged with the main file's enum names before bundling.
     * Only needed when extraPlugins accumulate enum names (e.g., tbaf-resolver).
     */
    readonly sharedEnumNames?: Set<string>;
    /**
     * Mutable set for extra plugins to add externalized enum names into.
     * Only needed when extraPlugins collect external enums (e.g., ts-extension-resolver).
     */
    readonly sharedExternalEnumNames?: Set<string>;
}

/** Result from the shared bundler. */
interface BundleResult {
    /** Cleaned and post-processed bundled code */
    readonly code: string;
    /** All enum names accumulated during bundling (main file + imports) */
    readonly allEnumNames: ReadonlySet<string>;
    /** Enum names from externalized .d.ts files (for prefix stripping) */
    readonly externalEnumNames: ReadonlySet<string>;
    /** Input files from metafile (only when metafile: true was requested) */
    readonly inputFiles: readonly string[];
}

/**
 * Shared esbuild bundler for all transpilers (TSSL, TBAF, TD).
 *
 * Handles the common bundling pipeline:
 * 1. Initialize esbuild
 * 2. Pre-transform enums to flat consts
 * 3. Accumulate enum names from imported files via plugins
 * 4. Run esbuild.build() with shared config + caller's extra plugins
 * 5. Clean up output (strip marker prefix, fix import aliases)
 * 6. Expand enum property accesses
 *
 * Callers provide language-specific config (marker, target, extra plugins).
 */
export async function bundleWithEsbuild(config: BundleConfig): Promise<BundleResult> {
    await ensureEsbuild();

    const { filePath, sourceText, marker, target, metafile } = config;

    // Pre-transform: convert enums to flat consts before esbuild sees them.
    // If caller already transformed (and needs the result for other purposes),
    // skip redundant work via preTransformed.
    const { code: enumTransformed, enumNames } = config.preTransformed
        ? { code: sourceText, enumNames: config.preTransformed.enumNames }
        : transformEnums(sourceText);

    // Accumulate enum names from imported files during bundling.
    // Mutated via closure in the enum-transform plugin.
    // If caller provided a shared set (for extra plugins that also accumulate enums),
    // merge main file enum names into it and use it as the canonical set.
    const allEnumNames = config.sharedEnumNames ?? new Set<string>();
    for (const name of enumNames) {
        allEnumNames.add(name);
    }

    // Accumulate externalized enum names from .d.ts files.
    // These are `declare enum` that esbuild drops - their property accesses
    // need prefix stripping (ClassID.ANKHEG -> ANKHEG) in post-processing.
    const externalEnumNames = config.sharedExternalEnumNames ?? new Set<string>();

    // Prepend marker, append extra code if provided
    const sourceWithMarker = marker + "\n" + enumTransformed + (config.appendCode ?? "");

    // Resolve symlinks so esbuild's absWorkingDir and sourcefile agree on real paths.
    // Without this, esbuild resolves absWorkingDir through symlinks but keeps sourcefile
    // as-is, producing deeply nested ../../../ relative paths in error messages.
    const realPath = fs.realpathSync(filePath);
    const resolveDir = path.dirname(realPath);

    const result = await esbuild.build({
        stdin: {
            contents: sourceWithMarker,
            resolveDir,
            sourcefile: config.sourcefile ?? realPath,
            loader: "ts",
        },
        // Use the file's directory as working dir so error paths are relative to it,
        // not to process.cwd() (which in VSCode is the extension install directory).
        absWorkingDir: resolveDir,
        bundle: true,
        write: false,
        metafile: metafile ?? false,
        format: "esm",
        treeShaking: true,
        minify: false,
        keepNames: false,
        target,
        platform: "neutral",
        plugins: [
            externalDeclarationsPlugin(externalEnumNames),
            ...(config.extraPlugins ?? []),
            // Transform enums in imported .ts files (shared across all transpilers).
            // Only .ts - transpiler source files (.tbaf, .td, .tssl) are not imported
            // by other transpiler files. Placed after extraPlugins so language-specific
            // resolvers run first.
            enumTransformPlugin(allEnumNames, /\.ts$/),
            noSideEffectsPlugin(),
        ],
    });

    // write: false guarantees outputFiles exists, but array might be empty
    const outputFile = result.outputFiles[0];
    if (outputFile === undefined) {
        throw new Error("esbuild produced no output");
    }

    // Strip ESM module boilerplate from esbuild output
    const cleaned = cleanupEsbuildOutput(outputFile.text, marker, config.originalConstants);

    // Post-expand: expand any remaining cross-file enum compat objects
    // and strip prefixes from externalized enum property accesses
    const code = expandEnumPropertyAccess(cleaned, allEnumNames, externalEnumNames);

    // Extract input files from metafile if requested.
    // Only .ts files, not .d.ts.
    // Metafile paths are relative to absWorkingDir - resolve to absolute.
    const inputFiles =
        metafile && result.metafile
            ? Object.keys(result.metafile.inputs)
                  .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
                  .map((f) => path.resolve(resolveDir, f))
            : [];

    return { code, allEnumNames, externalEnumNames, inputFiles };
}

/**
 * Clean up esbuild output by stripping marker prefix and fixing import aliases.
 *
 * esbuild renames identifiers when there are name collisions (e.g., See -> See2).
 * This function:
 * 1. Strips everything before the marker (runtime helpers like __defProp, __name)
 * 2. Builds alias map from import statements (regex)
 * 3. Detects collision patterns (name2 -> name22)
 * 4. Uses original constants to restore esbuild-renamed identifiers
 * 5. Renames identifiers back to originals (string-aware, skips string literals)
 * 6. Removes import declarations
 *
 * Uses regex + string-aware tokenization instead of a full TypeScript AST parser.
 * esbuild output is predictable (no regex literals, no exotic syntax), making
 * this safe. Verified against the ts-morph implementation on all three transpiler
 * outputs (TSSL, TBAF, TD) - produces identical results.
 *
 * @param code Bundled code from esbuild
 * @param marker Marker string to find start of user code
 * @param originalConstants Original constant names and values from source file (for restoring renamed vars)
 * @returns Cleaned code
 */
export function cleanupEsbuildOutput(code: string, marker: string, originalConstants?: Map<string, string>): string {
    // Step 1: Strip everything before marker
    const markerIndex = code.indexOf(marker);
    if (markerIndex !== -1) {
        code = code.substring(markerIndex + marker.length).trimStart();
    }

    // Step 2: Extract import aliases via regex
    // Matches: import { name as alias, name2 as alias2 } from "...";
    const aliasMap = new Map<string, string>();
    const importRegex = /^import\s*\{[^}]*\}\s*from\s*"[^"]*"\s*;?\s*$/gm;
    let importMatch;
    while ((importMatch = importRegex.exec(code)) !== null) {
        const specifiers = importMatch[0];
        const asRegex = /(\w+)\s+as\s+(\w+)/g;
        let asMatch;
        while ((asMatch = asRegex.exec(specifiers)) !== null) {
            // Groups 1 and 2 are guaranteed by the regex pattern
            aliasMap.set(asMatch[2]!, asMatch[1]!);
        }
    }

    // Step 3: Detect esbuild's collision avoidance
    // If alias See2 exists and identifier See22 exists in code -> See22->See2
    const allIdentifiers = new Set<string>();
    forEachCodeSegment(code, (segment) => {
        const wordRegex = /\b[A-Za-z_$]\w*\b/g;
        let m;
        while ((m = wordRegex.exec(segment)) !== null) {
            allIdentifiers.add(m[0]);
        }
    });

    for (const [alias] of aliasMap) {
        for (const id of allIdentifiers) {
            if (id.startsWith(alias) && id !== alias && /^\d+$/.test(id.slice(alias.length))) {
                if (!aliasMap.has(id)) {
                    aliasMap.set(id, alias);
                    aliasMap.delete(alias);
                }
            }
        }
    }

    // Step 4: Detect and fix esbuild's variable renaming due to name collisions.
    //
    // Problem: When TSSL defines a constant that also exists in folib imports,
    // esbuild renames the local constant by appending a single digit to avoid collision.
    // Example: `const DIK_F4 = 62` in TSSL + `DIK_F4` exported from folib
    //          -> esbuild outputs `var DIK_F42 = 62` (appended '2')
    //
    // Solution: Use the original constants extracted from the TSSL source file
    // (passed via originalConstants parameter) to identify and reverse these renames.
    //
    // Algorithm:
    // 1. Find all var declarations in bundled code via regex: name -> value
    // 2. For each var ending in a digit, strip the last char to get candidate original name
    // 3. If originalConstants has that name with the SAME value, it's a rename -> restore it
    //
    // Why this is robust:
    // - Requires BOTH name pattern match AND exact value equality
    // - Not just regex pattern matching - uses actual constant values from source
    // - False positive scenario: original has `FOO=5` and `FOO2=5` (same value)
    //   This is rare and would require user to define two constants with same value
    //   where one name is the other plus a digit - unlikely in practice
    if (originalConstants !== undefined && originalConstants.size > 0) {
        const varDeclRegex = /^var\s+(\w+)\s*=\s*(.+?)\s*;$/gm;
        let varMatch;
        while ((varMatch = varDeclRegex.exec(code)) !== null) {
            // Groups 1 and 2 are guaranteed by the regex pattern
            const bundledName = varMatch[1]!;
            const bundledValue = varMatch[2]!;
            if (!/\d$/.test(bundledName)) continue;
            const baseName = bundledName.slice(0, -1);
            if (originalConstants.get(baseName) === bundledValue && !aliasMap.has(bundledName)) {
                aliasMap.set(bundledName, baseName);
            }
        }
    }

    // Step 5: Remove import declarations (single-line and multi-line)
    code = code.replace(/^import\s*\{[^}]*\}\s*from\s*"[^"]*"\s*;?[^\S\n]*\n?/gm, "");

    // Step 6: Rename identifiers (string-aware, skips string literals and comments)
    if (aliasMap.size > 0) {
        // Sort by length (longest first) to avoid partial replacements
        const sorted = [...aliasMap.entries()].sort((a, b) => b[0].length - a[0].length);

        const pattern = new RegExp("\\b(" + sorted.map(([alias]) => escapeRegex(alias)).join("|") + ")\\b", "g");

        code = replaceOutsideStrings(code, pattern, (match) => aliasMap.get(match) ?? match);
    }

    return code;
}

/**
 * Iterate over segments of code that are NOT inside string literals or comments.
 * Used for collecting identifiers safely.
 */
export function forEachCodeSegment(code: string, fn: (segment: string) => void): void {
    let i = 0;
    let segStart = 0;
    while (i < code.length) {
        const ch = code[i];
        if (ch === '"' || ch === "'") {
            if (i > segStart) fn(code.substring(segStart, i));
            i = skipString(code, i);
            segStart = i;
        } else if (ch === "`") {
            if (i > segStart) fn(code.substring(segStart, i));
            i = skipTemplateLiteral(code, i);
            segStart = i;
        } else if (ch === "/" && i + 1 < code.length && code[i + 1] === "/") {
            if (i > segStart) fn(code.substring(segStart, i));
            while (i < code.length && code[i] !== "\n") i++;
            segStart = i;
        } else if (ch === "/" && i + 1 < code.length && code[i + 1] === "*") {
            if (i > segStart) fn(code.substring(segStart, i));
            i = skipBlockComment(code, i);
            segStart = i;
        } else {
            i++;
        }
    }
    if (i > segStart) fn(code.substring(segStart, i));
}

/**
 * Replace regex matches in code, but only outside string literals and comments.
 * Strings (single/double/template) and comments (line/block) are copied verbatim.
 * Safe for esbuild output which has no regex literals.
 */
export function replaceOutsideStrings(code: string, pattern: RegExp, replacer: (match: string) => string): string {
    let result = "";
    let i = 0;
    while (i < code.length) {
        const ch = code[i];
        if (ch === '"' || ch === "'") {
            const end = skipString(code, i);
            result += code.substring(i, end);
            i = end;
        } else if (ch === "`") {
            const end = skipTemplateLiteral(code, i);
            result += code.substring(i, end);
            i = end;
        } else if (ch === "/" && i + 1 < code.length && code[i + 1] === "/") {
            let end = i;
            while (end < code.length && code[end] !== "\n") end++;
            result += code.substring(i, end);
            i = end;
        } else if (ch === "/" && i + 1 < code.length && code[i + 1] === "*") {
            const end = skipBlockComment(code, i);
            result += code.substring(i, end);
            i = end;
        } else {
            // Accumulate code until next string/comment boundary
            let end = i;
            while (end < code.length) {
                const c = code[end];
                if (c === '"' || c === "'" || c === "`") break;
                if (c === "/" && end + 1 < code.length && (code[end + 1] === "/" || code[end + 1] === "*")) break;
                end++;
            }
            result += code.substring(i, end).replace(pattern, replacer);
            i = end;
        }
    }
    return result;
}

/** Skip past a quoted string (single or double). Returns index after closing quote. */
export function skipString(code: string, start: number): number {
    const quote = code[start];
    let i = start + 1;
    while (i < code.length) {
        if (code[i] === "\\") {
            i += 2;
            continue;
        }
        if (code[i] === quote) return i + 1;
        i++;
    }
    return i;
}

/** Skip past a template literal. Returns index after closing backtick. */
export function skipTemplateLiteral(code: string, start: number): number {
    let i = start + 1;
    while (i < code.length) {
        if (code[i] === "\\") {
            i += 2;
            continue;
        }
        if (code[i] === "`") return i + 1;
        if (code[i] === "$" && i + 1 < code.length && code[i + 1] === "{") {
            // Template expression - scan for matching }, handling nested strings/templates
            i += 2;
            let braceDepth = 1;
            while (i < code.length && braceDepth > 0) {
                if (code[i] === "{") braceDepth++;
                else if (code[i] === "}") braceDepth--;
                else if (code[i] === '"' || code[i] === "'") {
                    i = skipString(code, i);
                    continue;
                } else if (code[i] === "`") {
                    i = skipTemplateLiteral(code, i);
                    continue;
                }
                i++;
            }
            continue;
        }
        i++;
    }
    return i;
}

/** Skip past a block comment. Returns index after closing `* /`. */
export function skipBlockComment(code: string, start: number): number {
    const end = code.indexOf("*/", start + 2);
    return end === -1 ? code.length : end + 2;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Create an esbuild plugin that marks all modules as side-effect-free.
 * Enables aggressive tree-shaking for transpilers with no JS runtime.
 * https://github.com/evanw/esbuild/issues/1895
 */
function noSideEffectsPlugin(): esbuild.Plugin {
    return {
        name: "no-side-effects",
        setup(build) {
            build.onResolve({ filter: /.*/ }, async (args) => {
                if (args.kind === "entry-point") return null;
                // Use pluginData to prevent infinite recursion (pluginData is typed as any by esbuild)
                if (args.pluginData?.fromNoSideEffectsPlugin === true) return null;
                const result = await build.resolve(args.path, {
                    resolveDir: args.resolveDir,
                    kind: args.kind,
                    pluginData: { fromNoSideEffectsPlugin: true },
                });
                if (result.errors.length > 0) return result;
                return { ...result, sideEffects: false };
            });
        },
    };
}

/**
 * Create an esbuild plugin that externalizes .d.ts imports (engine builtins).
 * Also collects `declare enum` names from externalized files for
 * prefix stripping in post-processing (ClassID.ANKHEG -> ANKHEG).
 *
 * @param externalEnumNames Mutable set to accumulate enum names from .d.ts files
 */
function externalDeclarationsPlugin(externalEnumNames: Set<string>): esbuild.Plugin {
    return {
        name: "external-declarations",
        setup(build) {
            build.onResolve({ filter: /\.d(\.ts)?$/ }, (args) => {
                const resolved = resolveDtsPath(path.resolve(args.resolveDir, args.path));
                collectDeclareEnums(resolved, externalEnumNames);
                return { path: args.path, external: true };
            });
        },
    };
}
