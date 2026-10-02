/**
 * The runtime import edges of a source file, for the guards that walk the module graph (import-cycles,
 * test-scoped-reach).
 *
 * Only RUNTIME edges count. `verbatimModuleSyntax` is on across the workspace, so `import type` and fully
 * type-only named imports are erased before the emitted module graph exists. Dynamic `import()` is excluded:
 * it defers evaluation, which is one of the ways an edge is legitimately broken.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * `import`/`export ... from "<specifier>"`. The clause may span lines but may not contain a quote or a
 * semicolon, which is what stops a lazy match from running past the end of one statement.
 */
const IMPORT_FROM = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;'"]*?)\bfrom\s*["']([^"']+)["']/g;

/** True for `import { type A, type B } from "x"` - every named binding erased, so no runtime edge. */
function isFullyTypeOnly(clause: string): boolean {
    const braced = /\{([^}]*)\}/.exec(clause);
    if (!braced) return false;
    const outsideBraces = clause
        .replace(/\{[^}]*\}/, "")
        .replaceAll(",", "")
        .trim();
    if (outsideBraces !== "") return false;
    const names = braced[1]!
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
    return names.length > 0 && names.every((name) => /^type\s/.test(name));
}

/** The file an import of `target` (an absolute path without its extension, or with `.js`) loads. */
export function resolveModulePath(target: string): string | undefined {
    const candidates = [
        ...(target.endsWith(".js") ? [target.replace(/\.js$/, ".ts")] : []),
        target,
        `${target}.ts`,
        `${target}.mts`,
        `${target}.cts`,
        `${target}.tsx`,
        path.join(target, "index.ts"),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

/** Every runtime import specifier in `source`, in order. */
export function runtimeImportSpecifiers(source: string): string[] {
    const specifiers: string[] = [];
    for (const match of source.matchAll(IMPORT_FROM)) {
        if (match[1]) continue;
        if (isFullyTypeOnly(match[2]!)) continue;
        specifiers.push(match[3]!);
    }
    return specifiers;
}

// Anchored to this file, not cwd: vitest runs these guards from the repo root and from scripts/.
const sharedDir = path.resolve(__dirname, "..", "..", "..", "shared");
/** The workspace package whose exports are its own source, so its specifiers are as local as a relative path. */
const sharedName = (JSON.parse(fs.readFileSync(path.join(sharedDir, "package.json"), "utf8")) as { name: string }).name;

/** The files `file` imports at runtime by relative path or through the shared source package. */
export function localImportTargets(file: string, source: string): string[] {
    const targets = new Set<string>();
    for (const specifier of runtimeImportSpecifiers(source)) {
        let target: string;
        if (specifier.startsWith(".")) target = path.resolve(path.dirname(file), specifier);
        else if (specifier.startsWith(`${sharedName}/`))
            target = path.join(sharedDir, specifier.slice(sharedName.length));
        else continue;
        const resolved = resolveModulePath(target);
        if (resolved !== undefined) targets.add(resolved);
    }
    return [...targets];
}
