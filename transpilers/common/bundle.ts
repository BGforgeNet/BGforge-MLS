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
import type * as rolldown from "rolldown";
import { bundleWithRolldown } from "./rolldown-utils";
import { transformEnums, collectDeclareEnums, resolveDtsPath, type EnumMember } from "./enum-transform";
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
        const { code, enums } = transformEnums(sourceText, lineMap);
        const transformed = enums.size > 0;
        const lines = transformed ? lineMap : Array.from({ length: lineCount(sourceText) }, (_, i) => i);
        return {
            code: transformed ? code : sourceText,
            origins: lines.map((line) => ({ file: filePath, line })),
        };
    }

    // Shared mutable collections for enum accumulation across plugins.
    // The shared bundler's enumTransformPlugin handles .ts files;
    // the tbaf-resolver plugin below handles .tbaf files.
    // The ts-extension-resolver collects external enum names from .d.ts files
    // that esbuild can't resolve (extensionless imports).
    const sharedEnums = new Map<string, ReadonlyArray<EnumMember>>();
    const sharedExternalEnumNames = new Set<string>();

    const result = await bundleWithRolldown({
        filePath,
        sourceText,
        marker: TBAF_CODE_MARKER,
        sharedEnums,
        sharedExternalEnumNames,
        extraPlugins: [transpilerResolverPlugin(sharedEnums, sharedExternalEnumNames)],
    });

    return { code: result.code, origins: result.origins };
}

/**
 * The esbuild path needed three plugins - external declarations, .tbaf loading, extensionless
 * resolution - because esbuild dispatches each hook by its own regex filter. rolldown gives one
 * `resolveId`/`load` pair per plugin and no filters, so the three collapse into one whose hooks branch
 * on the specifier themselves. Fewer moving parts, but the branch order is now load-bearing: `.d.ts`
 * has to be tested before the extensionless case, which esbuild's filters expressed structurally.
 */
function transpilerResolverPlugin(
    sharedEnums: Map<string, ReadonlyArray<EnumMember>>,
    sharedExternalEnumNames: Set<string>,
): rolldown.Plugin {
    return {
        name: "transpiler-resolver",

        resolveId(source: string, importer: string | undefined) {
            const from = importer === undefined ? undefined : path.dirname(importer);
            if (from === undefined) return null;

            // Declaration files are type-only: externalise them, but read their enums first.
            if (/\.d(\.ts)?$/.test(source)) {
                collectDeclareEnums(resolveDtsPath(path.resolve(from, source)), sharedExternalEnumNames);
                return { id: source, external: true };
            }
            if (source.endsWith(".tbaf")) return path.resolve(from, source);

            // Extensionless relative imports. Packages like ielib write "./actions" for a .d.ts, which
            // no bundler's default resolver reaches, since it appends single extensions only.
            if (source.startsWith(".") && path.extname(source) === "") {
                const base = path.resolve(from, source);
                if (fs.existsSync(base + ".d.ts")) {
                    collectDeclareEnums(base + ".d.ts", sharedExternalEnumNames);
                    return { id: source + ".d.ts", external: true };
                }
                if (fs.existsSync(base + ".ts")) return base + ".ts";
                const indexTs = path.join(base, "index.ts");
                if (fs.existsSync(indexTs)) return indexTs;
            }
            return null;
        },

        load(id: string) {
            if (id.endsWith(".d.ts")) return null;
            if (!id.endsWith(".tbaf") && !id.endsWith(".ts")) return null;

            let source: string;
            try {
                source = fs.readFileSync(id, "utf-8");
            } catch {
                return null;
            }
            if (!source.includes("enum ")) {
                // A .tbaf is not a extension rolldown knows; a .ts it can read itself.
                return id.endsWith(".tbaf") ? { code: source, moduleType: "ts" } : null;
            }
            const { code, enums } = transformEnums(source);
            for (const [name, members] of enums) sharedEnums.set(name, members);
            return { code, moduleType: "ts" };
        },
    };
}
