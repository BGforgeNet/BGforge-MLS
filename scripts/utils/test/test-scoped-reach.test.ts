/**
 * Guard: scripts/test-scoped.sh runs a suite whenever a change could reach it.
 *
 * Each suite's trigger prefixes are hand-maintained, and a suite whose tests import a tree its prefixes do not
 * name is silently skipped when that tree changes: the scoped run reports green on code it never exercised.
 * This walks each suite's test files through their runtime imports - relative paths, plus the aliases its vitest
 * config maps to source - and fails on any reached file no prefix of that suite covers.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { relativeImportTargets, resolveModulePath, runtimeImportSpecifiers } from "./import-graph.ts";

// Anchored to this file, not cwd: vitest runs this config from the repo root and from scripts/.
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const script = fs.readFileSync(path.join(repoRoot, "scripts/test-scoped.sh"), "utf8");

/** One `declare -A <name>=( [id]="value" ... )` table from the script, comment lines skipped. */
function table(name: string): Map<string, string> {
    const body = new RegExp(`declare -A ${name}=\\(\\n([\\s\\S]*?)\\n\\)`).exec(script)?.[1];
    if (body === undefined) throw new Error(`test-scoped.sh has no ${name} table`);
    const entries = new Map<string, string>();
    for (const line of body.split("\n")) {
        const entry = /^\s*\["?([\w-]+)"?\]="([^"]*)"/.exec(line);
        if (entry) entries.set(entry[1]!, entry[2]!);
    }
    return entries;
}

const checks = table("suite_check");
const prefixes = table("suite_prefixes");

/** `"<specifier>": path.resolve(import.meta.dirname, "<target>")` entries, longest specifier first. */
function aliasesOf(config: string, text: string): [string, string][] {
    const found: [string, string][] = [];
    for (const m of text.matchAll(/"(@[\w/.-]+)":\s*path\.resolve\(import\.meta\.dirname,\s*"([^"]+)"\)/g)) {
        found.push([m[1]!, path.resolve(path.dirname(config), m[2]!)]);
    }
    return found.sort((a, b) => b[0].length - a[0].length);
}

/** The files a suite's tests reach, repo-relative. */
function reach(configPath: string): string[] {
    const config = path.join(repoRoot, configPath);
    const text = fs.readFileSync(config, "utf8");
    const include = /include:\s*\[path\.resolve\(import\.meta\.dirname,\s*"([^"]+)"\)/.exec(text)?.[1];
    if (include === undefined) throw new Error(`${configPath} has no absolute include pattern`);
    const aliases = aliasesOf(config, text);
    const queue = fs.globSync(include, { cwd: path.dirname(config) }).map((f) => path.join(path.dirname(config), f));
    const seen = new Set<string>();
    while (queue.length > 0) {
        const file = queue.pop()!;
        if (seen.has(file) || file.includes(`${path.sep}node_modules${path.sep}`)) continue;
        seen.add(file);
        if (!/\.(m?ts|svelte)$/.test(file)) continue;
        const source = fs.readFileSync(file, "utf8");
        queue.push(...relativeImportTargets(file, source));
        for (const specifier of runtimeImportSpecifiers(source)) {
            const alias = aliases.find(([key]) => specifier === key || specifier.startsWith(`${key}/`));
            if (!alias) continue;
            const resolved = resolveModulePath(alias[1] + specifier.slice(alias[0].length));
            if (resolved !== undefined) queue.push(resolved);
        }
    }
    return [...seen].map((file) => path.relative(repoRoot, file));
}

// The `client` suite is the client's typecheck + format script, not a vitest config; client-unit carries the
// client's tests.
const suites = [...checks].filter(([, config]) => /vitest[\w.]*\.m?ts$/.test(config));

describe("test-scoped.sh suite triggers", () => {
    it("reads every vitest suite from the script", () => {
        // Guards the guard: a parse that found nothing would pass the check below vacuously.
        expect(suites.length).toBeGreaterThan(10);
    });

    it.each(suites)("%s is triggered by every tree its tests import", (id, config) => {
        const covered = (prefixes.get(id) ?? "").split(" ").filter(Boolean);
        const files = reach(config);
        expect(files.length).toBeGreaterThan(0);
        const missing = files.filter((file) => !covered.some((prefix) => file.startsWith(prefix)));
        // Reported as the directories holding them, which is what a prefix names.
        expect([...new Set(missing.map((file) => `${path.dirname(file)}/`))].sort()).toStrictEqual([]);
    });
});
