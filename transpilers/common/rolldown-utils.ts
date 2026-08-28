/**
 * Shared rolldown bundler for the transpilers, mirroring esbuild-utils.ts step for step.
 *
 * Prototype: exists alongside the esbuild path so the two can be compared on the same inputs. It runs
 * the wasm in-process, so unlike esbuild-wasm it needs no `node` on PATH and installs no shim.
 *
 * Four rolldown defaults have to be overridden, each found by a failing check rather than predicted:
 *
 * - `minify` DEFAULTS TO "dce-only", not off. That mode still runs oxc's single-use-symbol
 *   substitution, which folds `const Color = {...}` into its one use site and destroys the `Color.Red`
 *   access expandEnumPropertyAccess matches on. esbuild gates the same pass behind minifySyntax AND
 *   excludes module scope, which is why the esbuild path never met it.
 * - `optimization.inlineConst` folds an imported `const LOCALS = "LOCALS"` into its use site. The BAF
 *   emitter quotes a string literal and passes an identifier through, so the folded form emits
 *   `Global("wm_Weave", ""LOCALS"", 1)` - invalid BAF, in 3 of the 13 real mod files in external/.
 * - `treeshake.moduleSideEffects` - esbuild drops an imported module whose exports go unused even when
 *   it has a top-level call into an external module; rolldown keeps that call without this.
 * - `comments` defaults to true, keeping JSDoc that the transpiler then has to read past.
 */

import * as fs from "fs";
import * as path from "path";
import type * as rolldown from "rolldown";
import { rolldown as bundleWith } from "rolldown";
import { transformEnums, expandEnumPropertyAccess, type EnumMember, type EnumRegistry } from "./enum-transform";
import { cleanupEsbuildOutput } from "./esbuild-utils";
import { lineCount, composeLineMaps, type SourcePosition } from "./line-map";
import { decodeMappings } from "./source-map";

/** Configuration for the shared rolldown bundler. Mirrors esbuild-utils' BundleConfig. */
interface BundleConfig {
    readonly filePath: string;
    readonly sourceText: string;
    /** Marker string prepended to source for stripping bundler runtime helpers. */
    readonly marker: string;
    readonly appendCode?: string;
    readonly extraPlugins?: rolldown.Plugin[];
    readonly sharedEnums?: Map<string, ReadonlyArray<EnumMember>>;
    readonly sharedExternalEnumNames?: Set<string>;
}

/** Result from the shared rolldown bundler. Mirrors esbuild-utils' BundleResult. */
interface BundleResult {
    readonly code: string;
    readonly allEnums: EnumRegistry;
    readonly externalEnumNames: ReadonlySet<string>;
    readonly origins: ReadonlyArray<SourcePosition | undefined>;
}

/**
 * The entry is handed to the bundler as a virtual module rather than read from disk, because it is the
 * enum-transformed text rather than the file's own bytes. Named under the entry's real directory so
 * relative imports inside it resolve the way they would from the file itself.
 */
const ENTRY_SUFFIX = "__transpiler_entry__.ts";

/**
 * Turn each surviving output line into the file and line it came from.
 *
 * The entry needs its own branch: it is the only source the bundler was handed rewritten, so its
 * origins run back through the marker shift and then through the enum flattening's line map.
 */
function resolveOrigins(
    lineMap: readonly number[],
    map: { sources?: string[]; mappings?: string } | undefined,
    resolveDir: string,
    entry: { alias: string; file: string; shift: number; lineMap: readonly number[] },
): Array<SourcePosition | undefined> {
    const unmapped: Array<SourcePosition | undefined> = lineMap.map(() => void 0);
    if (map === undefined) return unmapped;

    const sources = map.sources ?? [];
    const perOutputLine = decodeMappings(map.mappings ?? "");

    function originAt(outputLine: number): SourcePosition | undefined {
        const origin = perOutputLine[outputLine];
        if (origin === undefined) return;
        const source = sources[origin.source];
        if (source === undefined) return;
        const resolved = path.resolve(resolveDir, source);
        if (resolved !== entry.alias) return { file: resolved, line: origin.line };
        // Only the entry was rewritten before the bundler read it: strip the marker it was given, then
        // take the line back through the enum flattening. Every other source arrived untouched.
        const beforeMarker = origin.line - entry.shift;
        const line = entry.lineMap[beforeMarker] ?? beforeMarker;
        if (line < 0) return;
        return { file: entry.file, line };
    }

    return lineMap.map((outputLine) => originAt(outputLine));
}

/** Bundle a transpiler source and its imports into a single TypeScript string, with line provenance. */
export async function bundleWithRolldown(config: BundleConfig): Promise<BundleResult> {
    const { filePath, sourceText, marker, appendCode } = config;

    const allEnums = config.sharedEnums ?? new Map<string, ReadonlyArray<EnumMember>>();
    const externalEnumNames = config.sharedExternalEnumNames ?? new Set<string>();

    const entryLineMap: number[] = [];
    const { code: enumTransformed, enums } = transformEnums(sourceText, entryLineMap);
    for (const [name, members] of enums) allEnums.set(name, members);

    const realPath = fs.realpathSync(filePath);
    const resolveDir = path.dirname(realPath);
    const entryId = path.join(resolveDir, ENTRY_SUFFIX);
    const contents = marker + "\n" + enumTransformed + (appendCode ?? "");

    const build = await bundleWith({
        input: entryId,
        // The counterpart of esbuild's absWorkingDir. rolldown writes sourcemap `sources` relative to
        // this, so leaving it at process.cwd() makes every origin resolve against the wrong root - and
        // the resulting paths still LOOK plausible, they just name no file.
        cwd: resolveDir,
        platform: "neutral",
        treeshake: { moduleSideEffects: false },
        optimization: { inlineConst: false },
        logLevel: "silent",
        plugins: [
            {
                name: "transpiler-entry",
                resolveId: (source: string) => (source === entryId ? entryId : null),
                load: (id: string) => (id === entryId ? { code: contents, moduleType: "ts" } : null),
            },
            ...(config.extraPlugins ?? []),
        ],
    });

    const { output } = await build.generate({
        format: "esm",
        sourcemap: true,
        minify: false,
        comments: false,
        // rolldown writes `sources` relative to where the MAP would sit, which is neither the entry's
        // directory nor the cwd. Resolving them here removes the guess: every source arrives absolute,
        // and the later path.resolve against resolveDir becomes a no-op instead of a second convention.
        sourcemapPathTransform: (source, sourcemapPath) => path.resolve(path.dirname(sourcemapPath), source),
    });
    await build.close();

    const chunk = output.find((o) => o.type === "chunk");
    if (chunk === undefined || chunk.type !== "chunk") {
        throw new Error(`rolldown produced no chunk for ${filePath}`);
    }

    const afterCleanup: number[] = [];
    const cleaned = cleanupEsbuildOutput(chunk.code, marker, afterCleanup);
    const afterExpand: number[] = [];
    const code = expandEnumPropertyAccess(cleaned, allEnums, externalEnumNames, afterExpand);

    const origins = resolveOrigins(composeLineMaps(afterCleanup, afterExpand), chunk.map ?? undefined, resolveDir, {
        alias: entryId,
        file: filePath,
        shift: lineCount(marker + "\n"),
        lineMap: entryLineMap,
    });

    return { code, allEnums, externalEnumNames, origins };
}
