/**
 * Guard: no new runtime import cycles among the tracked TypeScript sources.
 *
 * A cycle costs nothing until module evaluation order starts to matter, at which point a consumer
 * that imports one member first gets a half-initialised binding - and the failure lands far from
 * the edge that caused it. The cycles that exist today are listed below with the reason each is
 * tolerated; anything else fails here.
 *
 * Only RUNTIME edges count. `verbatimModuleSyntax` is on across the workspace, so `import type` and
 * fully type-only named imports are erased before the emitted module graph exists and cannot
 * participate in an initialisation cycle. Dynamic `import()` is excluded for the same reason: it
 * defers evaluation, which is one of the ways an edge is legitimately broken. Scope is `.ts`/`.mts`/
 * `.cts`/`.tsx`; `.svelte` components compose recursively by design and are not part of this graph.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

// Anchored to this file, not cwd: vitest runs this config from the repo root and from scripts/.
const repoRoot = path.resolve(__dirname, "..", "..", "..");

/**
 * Cycles that stay. Each entry is the full member list of one strongly connected component,
 * repo-relative and sorted; a cycle that grows or shrinks a member no longer matches and fails.
 */
const ALLOWED: readonly { readonly reason: string; readonly files: readonly string[] }[] = [
    {
        // Domain-imposed: a recursive-descent formatter for a language whose statements contain
        // expressions and whose expressions contain statements cannot be a DAG.
        reason: "fallout-ssl formatter recursive descent",
        files: [
            "format/src/fallout-ssl/control-flow.ts",
            "format/src/fallout-ssl/core.ts",
            "format/src/fallout-ssl/expressions.ts",
        ],
    },
];

/**
 * `import`/`export ... from "<specifier>"`. The clause may span lines but may not contain a quote
 * or a semicolon, which is what stops a lazy match from running past the end of one statement.
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

function resolveRelative(fromFile: string, specifier: string): string | undefined {
    const target = path.resolve(path.dirname(fromFile), specifier);
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

const files = execSync("git ls-files -- '*.ts' '*.mts' '*.cts' '*.tsx'", {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
})
    .split("\n")
    .filter(Boolean)
    .filter((file) => !file.endsWith(".d.ts"))
    .filter((file) => !file.split("/").some((seg) => seg === "node_modules" || seg === "out" || seg === "dist"))
    .map((file) => path.join(repoRoot, file));

const graph = new Map<string, string[]>();
for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const targets = new Set<string>();
    for (const match of source.matchAll(IMPORT_FROM)) {
        if (match[1]) continue;
        if (isFullyTypeOnly(match[2]!)) continue;
        const specifier = match[3]!;
        if (!specifier.startsWith(".")) continue;
        const resolved = resolveRelative(file, specifier);
        if (resolved !== undefined) targets.add(resolved);
    }
    graph.set(file, [...targets]);
}

/** Tarjan's strongly connected components; components of size 1 are not cycles here. */
function findCycles(): string[][] {
    let counter = 0;
    const stack: string[] = [];
    const onStack = new Set<string>();
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const components: string[][] = [];

    function visit(node: string): void {
        index.set(node, counter);
        low.set(node, counter);
        counter += 1;
        stack.push(node);
        onStack.add(node);
        for (const next of graph.get(node) ?? []) {
            if (!graph.has(next)) continue;
            if (!index.has(next)) {
                visit(next);
                low.set(node, Math.min(low.get(node)!, low.get(next)!));
            } else if (onStack.has(next)) {
                low.set(node, Math.min(low.get(node)!, index.get(next)!));
            }
        }
        if (low.get(node) !== index.get(node)) return;
        const component: string[] = [];
        let member: string;
        do {
            member = stack.pop()!;
            onStack.delete(member);
            component.push(member);
        } while (member !== node);
        if (component.length > 1) components.push(component);
    }

    for (const node of graph.keys()) if (!index.has(node)) visit(node);
    return components;
}

const cycles = findCycles()
    .map((component) => component.map((file) => path.relative(repoRoot, file)).sort())
    .map((component) => component.join(" <-> "))
    .sort();

const allowed = ALLOWED.map((entry) => [...entry.files].sort().join(" <-> ")).sort();

describe("runtime import cycles", () => {
    it("builds a module graph over the tracked sources", () => {
        // Positive control: the verdicts below mean nothing if the walk saw no files or no edges.
        expect(files.length).toBeGreaterThan(1000);
        expect([...graph.values()].reduce((total, targets) => total + targets.length, 0)).toBeGreaterThan(1000);
    });

    it("are limited to the ones listed here", () => {
        expect(cycles).toEqual(allowed);
    });
});
