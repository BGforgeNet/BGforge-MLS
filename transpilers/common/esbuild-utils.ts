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
import { ensureNodeOnPath } from "./node-runtime";
import { lineCount, composeLineMaps, type SourcePosition } from "./line-map";
import { decodeMappings } from "./source-map";

let esbuildInitialized = false;

/**
 * Initialize esbuild (singleton, safe to call multiple times).
 * Native esbuild (used by CLI via alias) doesn't need initialize().
 * esbuild-wasm (used by LSP server) requires it.
 *
 * esbuild-wasm spawns `node <bin/esbuild>` via a bare PATH lookup; ensureNodeOnPath points `node`
 * at the extension host's own runtime first (see node-runtime.ts), so an absent or broken PATH
 * `node` can't break bundling.
 */
async function ensureEsbuild(): Promise<void> {
    if (esbuildInitialized) return;
    ensureNodeOnPath();
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
    /** For each line of `code`, the file and 0-based line it came from; absent where the map has none. */
    readonly origins: ReadonlyArray<SourcePosition | undefined>;
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
    // Where each line of the entry stood before its enums were flattened: without the map, the lines
    // below an enum would be reported one place off for every line the flattening removed.
    const entryLineMap: number[] = [];
    const { code: enumTransformed, enumNames } = transformEnums(sourceText, entryLineMap);

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
        // Asked for so a position in the bundle can be traced back to the file the author wrote. It is
        // never written to disk - `write: false` hands it back alongside the code, and only the mappings
        // are read. "external" rather than true: the inline form appends a `sourceMappingURL` comment to
        // the code, which would then be one more line for the parser downstream to read.
        sourcemap: "external",
        // Named only because an external map is refused without an output path. `write: false` means
        // nothing reaches disk under this name; it exists so the map arrives as its own output file.
        outfile: path.join(resolveDir, "bundle.js"),
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
            // No plugin marks modules `sideEffects: false` here. One used to, for TSSL, which now
            // compiles through compilers/tssl and never reaches this function. It matched every import
            // and awaited build.resolve() per module - 18 nested round-trips into the wasm on a real
            // mod file, ~150ms of a ~270ms bundle - while esbuild's own tree-shaking already dropped
            // the same modules: output was byte-identical across the external corpus without it.
        ],
    });

    // write: false guarantees outputFiles exists, but array might be empty
    // Selected by extension rather than by index: asking for a source map adds a second output file, so
    // the first is no longer reliably the code.
    const outputFile = result.outputFiles.find((file) => !file.path.endsWith(".map"));
    if (outputFile === undefined) {
        throw new Error("esbuild produced no output");
    }
    const mapFile = result.outputFiles.find((file) => file.path.endsWith(".map"));

    // Strip ESM module boilerplate from esbuild output
    const afterCleanup: number[] = [];
    const cleaned = cleanupEsbuildOutput(outputFile.text, marker, afterCleanup);

    // Post-expand: expand any remaining cross-file enum compat objects
    // and strip prefixes from externalized enum property accesses
    const afterExpand: number[] = [];
    const code = expandEnumPropertyAccess(cleaned, allEnumNames, externalEnumNames, afterExpand);

    // Both passes only ever moved lines relative to what esbuild emitted, so composing them lands on a
    // line of that output; the source map then says which file and line that came from.
    const lineMap = composeLineMaps(afterCleanup, afterExpand);
    const origins = resolveOrigins(lineMap, mapFile?.text, resolveDir, {
        // What esbuild will call the entry in its map. `sourcefile` is a label, not a path, so it is
        // resolved the way the map's other sources are - otherwise a relative one never compares equal
        // and the entry is mistaken for an import.
        alias: path.resolve(resolveDir, config.sourcefile ?? realPath),
        // What to report it as: the path the caller passed in. The label above stands in for it where a
        // transpiler hands esbuild a name its own loader understands, and the resolved form names the
        // same file under a path the caller never used - which a consumer comparing the two reads as a
        // different file entirely.
        file: filePath,
        // esbuild reads the entry as `marker + "\n" + source`, so every line it reports for that file
        // sits one lower in the file the author actually has open. Other sources are read as-is.
        shift: lineCount(marker + "\n"),
        lineMap: entryLineMap,
    });

    // Extract input files from metafile if requested.
    // Only .ts files, not .d.ts.
    // Metafile paths are relative to absWorkingDir - resolve to absolute.
    const inputFiles =
        metafile && result.metafile
            ? Object.keys(result.metafile.inputs)
                  .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
                  .map((f) => path.resolve(resolveDir, f))
            : [];

    return { code, allEnumNames, externalEnumNames, inputFiles, origins };
}

/**
 * Turns each bundled line into the file and line it came from, given the esbuild output line it sits on.
 *
 * A line with no mapping stays undefined rather than borrowing its neighbour's: an approximate origin is
 * indistinguishable from a real one once it reaches an error message, and a missing one at least says so.
 * The map's `sources` are relative to the directory esbuild worked in, so they are resolved against it.
 */
function resolveOrigins(
    lineMap: readonly number[],
    mapText: string | undefined,
    resolveDir: string,
    entry: { alias: string; file: string; shift: number; lineMap: readonly number[] },
): Array<SourcePosition | undefined> {
    const unmapped: Array<SourcePosition | undefined> = lineMap.map(() => void 0);
    if (mapText === undefined) return unmapped;

    const parsed = JSON.parse(mapText) as { sources?: string[]; mappings?: string };
    const sources = parsed.sources ?? [];
    const perOutputLine = decodeMappings(parsed.mappings ?? "");

    function originAt(outputLine: number): SourcePosition | undefined {
        const origin = perOutputLine[outputLine];
        if (origin === undefined) return;
        const source = sources[origin.source];
        if (source === undefined) return;
        const resolved = path.resolve(resolveDir, source);
        if (resolved !== entry.alias) return { file: resolved, line: origin.line };
        // Only the entry was rewritten before esbuild read it: strip the marker it was given, then take
        // the line back through the enum flattening. Every other source reached esbuild untouched.
        const beforeMarker = origin.line - entry.shift;
        const line = entry.lineMap[beforeMarker] ?? beforeMarker;
        // A prepended line can push an early mapping above the file's own first line; that names nothing
        // the author can open, so it is dropped rather than clamped onto an unrelated line.
        if (line < 0) return;
        return { file: entry.file, line };
    }

    return lineMap.map((outputLine) => originAt(outputLine));
}

/**
 * Clean up esbuild output by stripping marker prefix and fixing import aliases.
 *
 * esbuild renames identifiers when there are name collisions (e.g., See -> See2).
 * This function:
 * 1. Strips everything before the marker (runtime helpers like __defProp, __name)
 * 2. Builds alias map from import statements (regex)
 * 3. Detects collision patterns (name2 -> name22)
 * 4. Removes import declarations
 * 5. Renames identifiers back to originals (string-aware, skips string literals)
 *
 * Uses regex + string-aware tokenization instead of a full TypeScript AST parser.
 * esbuild output is predictable (no regex literals, no exotic syntax), making this safe.
 *
 * @param code Bundled code from esbuild
 * @param marker Marker string to find start of user code
 * @returns Cleaned code
 */
export function cleanupEsbuildOutput(
    code: string,
    marker: string,
    /**
     * Filled, when passed, with the 0-based input line each output line came from. Reported rather than
     * returned so the existing call sites keep their `string` return; only a caller tracing a position
     * back through the bundle asks for it.
     */
    survivors?: number[],
): string {
    // Step 1: Strip everything before marker
    const markerIndex = code.indexOf(marker);
    // Lines the prefix strip consumes. Every later line index is stated relative to the ORIGINAL input,
    // so this offset is added back at the end rather than tracked through each step.
    let droppedAhead = 0;
    if (markerIndex !== -1) {
        const afterMarker = code.substring(markerIndex + marker.length);
        const lead = afterMarker.length - afterMarker.trimStart().length;
        droppedAhead = lineCount(code.substring(0, markerIndex + marker.length + lead));
        code = afterMarker.trimStart();
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

    // Step 4: Remove import declarations (single-line and multi-line)
    const importDecl = /^import\s*\{[^}]*\}\s*from\s*"[^"]*"\s*;?[^\S\n]*\n?/gm;
    // The ranges are read off the same matches the removal uses, before it runs: deriving them from the
    // result instead would have to re-identify lines by content, which step 5's renaming then breaks.
    const removed = new Set<number>();
    if (survivors !== undefined) {
        for (const match of code.matchAll(importDecl)) {
            const from = lineCount(code.substring(0, match.index));
            // A match that swallowed its newline vacates exactly the lines it spans. One at end-of-input
            // has no newline to swallow and leaves an empty last line, which collapses into the trailing
            // newline every other line already ends with - so it vacates one line more.
            const span = match[0].endsWith("\n") ? lineCount(match[0]) : lineCount(match[0]) + 1;
            for (let line = from; line < from + span; line++) removed.add(line);
        }
        const total = lineCount(code);
        for (let line = 0; line < total; line++) {
            if (!removed.has(line)) survivors.push(droppedAhead + line);
        }
    }
    code = code.replaceAll(importDecl, "");

    // Step 5: Rename identifiers (string-aware, skips string literals and comments)
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

        // Pass through string/template/comment spans verbatim; only code spans
        // get the replacer applied.
        let end: number;
        let isCode = false;
        if (ch === '"' || ch === "'") {
            end = skipString(code, i);
        } else if (ch === "`") {
            end = skipTemplateLiteral(code, i);
        } else if (ch === "/" && i + 1 < code.length && code[i + 1] === "/") {
            end = i;
            while (end < code.length && code[end] !== "\n") end++;
        } else if (ch === "/" && i + 1 < code.length && code[i + 1] === "*") {
            end = skipBlockComment(code, i);
        } else {
            // Accumulate code until next string/comment boundary
            end = i;
            while (end < code.length) {
                const c = code[end];
                if (c === '"' || c === "'" || c === "`") break;
                if (c === "/" && end + 1 < code.length && (code[end + 1] === "/" || code[end + 1] === "*")) break;
                end++;
            }
            isCode = true;
        }

        const segment = code.substring(i, end);
        result += isCode ? segment.replace(pattern, replacer) : segment;
        i = end;
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
    return s.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
