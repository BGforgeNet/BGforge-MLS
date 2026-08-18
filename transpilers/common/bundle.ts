/**
 * Shared Transpiler Bundler
 *
 * Delegates to the shared esbuild bundler with these plugins, and is imported by
 * both @bgforge/tbaf and @bgforge/td:
 * - tbaf-resolver: resolves and loads .tbaf imports as TypeScript
 * - ts-extension-resolver: resolves extensionless imports to .d.ts/.ts/index.ts
 *
 * IMPORTANT: External libraries (ielib, folib) must use NAMED re-exports, not
 * `export * from`. esbuild cannot statically enumerate exports from externalized
 * `.d.ts` modules behind `export *`, falling back to runtime `__reExport` helpers
 * that break downstream transpilers. Named re-exports let esbuild resolve each
 * binding statically. See folib's index.ts for the correct pattern.
 */

import * as fs from "fs";
import * as path from "path";
import type * as esbuild from "esbuild-wasm";
import { bundleWithEsbuild } from "./esbuild-utils";
import { transformEnums, collectDeclareEnums } from "./enum-transform";
import { hasImports } from "./transpiler-utils";
import { lineCount, type SourcePosition } from "./line-map";

/** Marker to identify start of user code in esbuild output */
const TBAF_CODE_MARKER = "/* __TBAF_CODE_START__ */";

/** Bundled text, plus the file and 0-based line each of its lines came from. */
export interface BundledSource {
    readonly code: string;
    readonly origins: ReadonlyArray<SourcePosition | undefined>;
}

/**
 * Bundle a TBAF file and its imports into a single TypeScript string.
 *
 * Skips bundling for files without imports - esbuild tree-shakes block-scoped
 * functions and applies number folding (1000 -> 1e3) that breaks transpiler output.
 *
 * @param filePath Absolute path to the .tbaf/.td file
 * @param sourceText Content of the source file
 * @returns Bundled TypeScript code (or the original text if no imports), with line provenance
 */
export async function bundle(filePath: string, sourceText: string): Promise<BundledSource> {
    // Transform local enums even for files without imports.
    // Note: esbuild bundling is skipped for files without imports to avoid
    // tree-shaking block-scoped functions and number folding issues.
    if (!hasImports(sourceText)) {
        // Nothing was bundled, so every line still belongs to this file - but flattening an enum drops
        // lines, and without the map the ones below it would be reported where the enum used to end.
        const lineMap: number[] = [];
        const { code, enumNames } = transformEnums(sourceText, lineMap);
        const transformed = enumNames.size > 0;
        const lines = transformed ? lineMap : Array.from({ length: lineCount(sourceText) }, (_, i) => i);
        return {
            code: transformed ? code : sourceText,
            origins: lines.map((line) => ({ file: filePath, line })),
        };
    }

    // Shared mutable sets for enum accumulation across plugins.
    // The shared bundler's enumTransformPlugin handles .ts files;
    // the tbaf-resolver plugin below handles .tbaf files.
    // The ts-extension-resolver collects external enum names from .d.ts files
    // that esbuild can't resolve (extensionless imports).
    const sharedEnumNames = new Set<string>();
    const sharedExternalEnumNames = new Set<string>();

    const result = await bundleWithEsbuild({
        filePath,
        sourceText,
        marker: TBAF_CODE_MARKER,
        target: "esnext",
        sharedEnumNames,
        sharedExternalEnumNames,
        extraPlugins: [tbafResolverPlugin(sharedEnumNames), tsExtensionResolverPlugin(sharedExternalEnumNames)],
    });

    return { code: result.code, origins: result.origins };
}

/**
 * Resolve and load .tbaf imports as TypeScript, transforming enums.
 * No custom namespace - keeps resolution simple so noSideEffectsPlugin's
 * build.resolve() can use esbuild's default resolver for all imports.
 */
function tbafResolverPlugin(sharedEnumNames: Set<string>): esbuild.Plugin {
    return {
        name: "tbaf-resolver",
        setup(build) {
            build.onResolve({ filter: /\.tbaf$/ }, (args) => ({
                path: path.resolve(args.resolveDir, args.path),
            }));

            build.onLoad({ filter: /\.tbaf$/ }, (args) => {
                const source = fs.readFileSync(args.path, "utf-8");
                if (source.includes("enum ")) {
                    const { code, enumNames: importedEnums } = transformEnums(source);
                    for (const name of importedEnums) {
                        sharedEnumNames.add(name);
                    }
                    return { contents: code, loader: "ts" };
                }
                return { contents: source, loader: "ts" };
            });
        },
    };
}

/**
 * Resolve extensionless relative imports that esbuild can't handle.
 * esbuild only appends single extensions (.ts, .tsx, etc.) but not
 * compound extensions like .d.ts. Packages like ielib use extensionless
 * imports (e.g., "./actions") that resolve to .d.ts declaration files.
 * This plugin tries .d.ts and externalizes those (they're type-only),
 * and also tries .ts / index.ts for regular source files.
 */
function tsExtensionResolverPlugin(sharedExternalEnumNames: Set<string>): esbuild.Plugin {
    return {
        name: "ts-extension-resolver",
        setup(build) {
            build.onResolve({ filter: /^\./ }, (args) => {
                if (path.extname(args.path)) return null;
                const base = path.resolve(args.resolveDir, args.path);
                // .d.ts - declaration file, externalize it
                if (fs.existsSync(base + ".d.ts")) {
                    collectDeclareEnums(base + ".d.ts", sharedExternalEnumNames);
                    return { path: args.path + ".d.ts", external: true };
                }
                // .ts - regular source, bundle it
                if (fs.existsSync(base + ".ts")) return { path: base + ".ts" };
                // index.ts - directory import
                const indexTs = path.join(base, "index.ts");
                if (fs.existsSync(indexTs)) return { path: indexTs };
                return null;
            });
        },
    };
}
