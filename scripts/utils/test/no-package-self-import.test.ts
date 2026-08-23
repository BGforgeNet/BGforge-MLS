/**
 * Guard: nothing under a workspace package's `src/` may import that package by its own name.
 *
 * A self-import resolves fine - the tsconfig `paths` entry, the vitest alias and the bundler all map
 * the name back to the package's own source - so it costs nothing until the package grows a second
 * entry point, at which point its internal plumbing is routed through the public door and the two
 * cannot be told apart. That is how `@bgforge/format` ended up importing itself in nine files: the
 * formatters moved out of `server/` in a rename git recorded as 100% identical, and the package-name
 * imports that were correct at the old path became self-imports at the new one, with no line changed.
 *
 * `test/` is deliberately exempt: a test importing its own package through the published entry point
 * is exercising the surface consumers get, which is what the public-API guards are for.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

// Anchored to this file, not cwd: vitest runs this config from the repo root and from scripts/.
const repoRoot = path.resolve(__dirname, "..", "..", "..");

function git(args: string): string[] {
    return execSync(`git ${args}`, { cwd: repoRoot, encoding: "utf8", timeout: SPAWN_TIMEOUT_MS })
        .split("\n")
        .filter(Boolean);
}

/** Workspace package directories (repo-relative) mapped to their declared name. */
const packages = new Map<string, string>();
for (const manifest of git("ls-files -- '*package.json'")) {
    const name: unknown = JSON.parse(fs.readFileSync(path.join(repoRoot, manifest), "utf8")).name;
    if (typeof name === "string" && name) packages.set(path.dirname(manifest), name);
}

/** Nearest enclosing package - transpilers/ nests transpilers/{common,tbaf,td}. */
function ownerOf(file: string): string | undefined {
    let best: string | undefined;
    for (const dir of packages.keys()) {
        const inside = dir === "." || file.startsWith(`${dir}/`);
        if (inside && (best === undefined || dir.length > best.length)) best = dir;
    }
    return best;
}

/** The package a bare specifier addresses: "@scope/pkg/sub" -> "@scope/pkg", "pkg/sub" -> "pkg". */
function specifierPackage(spec: string): string {
    const parts = spec.split("/");
    return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

// `from "x"` covers import/export-from; the other branches cover `import("x")`, `require("x")`
// and the bare side-effect form `import "x"`, which has no `from` and was missed at first.
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;

const offenders = git("ls-files -- '*.ts' '*.mts' '*.cts' '*.tsx' '*.js' '*.mjs' '*.svelte'")
    .filter((file) => !file.split("/").some((seg) => seg === "node_modules" || seg === "out" || seg === "dist"))
    .flatMap((file) => {
        const owner = ownerOf(file);
        if (owner === undefined) return [];
        const pkgName = packages.get(owner)!;
        // src/ only - see the test/ exemption above.
        if (!file.startsWith(`${owner === "." ? "" : `${owner}/`}src/`)) return [];
        const text = fs.readFileSync(path.join(repoRoot, file), "utf8");
        return [...text.matchAll(IMPORT)]
            .map((m) => m[1]!)
            .filter((spec) => !spec.startsWith(".") && !spec.startsWith("/") && !spec.startsWith("#"))
            .filter((spec) => specifierPackage(spec) === pkgName)
            .map((spec) => `${file} imports "${spec}"`);
    });

describe("workspace packages", () => {
    it("finds the packages to check", () => {
        // Positive control: the walk is only meaningful if it actually saw the packages.
        expect(packages.size).toBeGreaterThan(10);
    });

    it("never import themselves from src/", () => {
        expect([...new Set(offenders)].sort()).toEqual([]);
    });
});
