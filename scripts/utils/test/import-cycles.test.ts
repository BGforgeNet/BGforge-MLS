/**
 * Guard: no new runtime import cycles among the tracked TypeScript sources.
 *
 * A cycle costs nothing until module evaluation order starts to matter, at which point a consumer
 * that imports one member first gets a half-initialised binding - and the failure lands far from
 * the edge that caused it. The cycles that exist today are listed below with the reason each is
 * tolerated; anything else fails here.
 *
 * Only runtime edges count (see import-graph.ts), since only those can take part in an initialisation
 * cycle. Scope is `.ts`/`.mts`/`.cts`/`.tsx`; `.svelte` components compose recursively by design and are
 * not part of this graph.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SPAWN_TIMEOUT_MS } from "@bgforge/shared/spawn-timeout.ts";
import { relativeImportTargets } from "./import-graph.ts";

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
    graph.set(file, relativeImportTargets(file, fs.readFileSync(file, "utf8")));
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
