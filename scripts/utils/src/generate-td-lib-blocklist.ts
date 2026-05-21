#!/usr/bin/env tsx
/**
 * Regenerate the ES_LIB_BLOCKLIST in plugins/td-plugin/src/filter-completions.ts
 * from the currently installed TypeScript's lib.es2020.d.ts reference chain.
 *
 * The blocklist hides ES built-in globals from completion in .td files (TD is
 * a constrained DSL with no JS runtime; surfaces like `Array`, `Promise`,
 * `Symbol` are noise). It must stay in sync with the lib bundled by the
 * project's pinned TypeScript: when the pin moves to a newer minor or major
 * (e.g. 5.9 -> 6.x), new globals appear and old ones may shift; if the
 * blocklist isn't refreshed, those new globals leak through into completion.
 *
 * Usage:
 *   pnpm exec tsx scripts/utils/src/generate-td-lib-blocklist.ts          # write
 *   pnpm exec tsx scripts/utils/src/generate-td-lib-blocklist.ts --check  # exit 1 on drift
 *
 * The CI guard (scripts/utils/test/td-lib-blocklist.test.ts) runs in --check
 * mode so the published filter stays aligned with the current pin.
 */

import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import * as ts from "typescript";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const TARGET_FILE = path.join(REPO_ROOT, "plugins/td-plugin/src/filter-completions.ts");
const requireFromHere = createRequire(import.meta.url);
const LIB_DIR = path.dirname(requireFromHere.resolve("typescript/package.json")) + "/lib";
const ROOT_LIB = "lib.es2020.d.ts"; // matches what tsserver loads for .td (ES2020 target)
const BEGIN_MARKER = "// BEGIN GENERATED ES_LIB_BLOCKLIST";
const END_MARKER = "// END GENERATED ES_LIB_BLOCKLIST";

function collectReferencedLibs(rootLib: string): string[] {
    const visited = new Set<string>();
    const order: string[] = [];
    const queue = [rootLib];
    while (queue.length > 0) {
        const name = queue.shift()!;
        if (visited.has(name)) continue;
        visited.add(name);
        order.push(name);
        const filePath = path.join(LIB_DIR, name);
        if (!fs.existsSync(filePath)) continue;
        const text = fs.readFileSync(filePath, "utf8");
        const refRegex = /\/\/\/\s*<reference\s+lib="([^"]+)"\s*\/>/g;
        let match: RegExpExecArray | null;
        while ((match = refRegex.exec(text)) !== null) {
            queue.push(`lib.${match[1]}.d.ts`);
        }
    }
    return order;
}

function extractTopLevelNames(filePath: string): string[] {
    const text = fs.readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
    const names: string[] = [];
    for (const stmt of sourceFile.statements) {
        // Interface declarations
        if (ts.isInterfaceDeclaration(stmt)) {
            names.push(stmt.name.text);
        } else if (ts.isTypeAliasDeclaration(stmt)) {
            names.push(stmt.name.text);
        } else if (ts.isClassDeclaration(stmt) && stmt.name) {
            names.push(stmt.name.text);
        } else if (ts.isEnumDeclaration(stmt)) {
            names.push(stmt.name.text);
        } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
            names.push(stmt.name.text);
        } else if (ts.isVariableStatement(stmt)) {
            for (const decl of stmt.declarationList.declarations) {
                if (ts.isIdentifier(decl.name)) {
                    names.push(decl.name.text);
                }
            }
        } else if (ts.isModuleDeclaration(stmt) && ts.isIdentifier(stmt.name)) {
            // namespace / module declarations (e.g. Intl, Reflect)
            names.push(stmt.name.text);
        }
    }
    return names;
}

function generateBlocklist(): string {
    const libs = collectReferencedLibs(ROOT_LIB);
    const all = new Set<string>();
    for (const lib of libs) {
        const filePath = path.join(LIB_DIR, lib);
        if (!fs.existsSync(filePath)) continue;
        for (const name of extractTopLevelNames(filePath)) {
            all.add(name);
        }
    }
    const sorted = [...all].sort();
    const lines = sorted.map((n) => `    ${JSON.stringify(n)},`).join("\n");
    return `const ES_LIB_BLOCKLIST: ReadonlySet<string> = new Set([\n${lines}\n]);`;
}

function rewriteTargetFile(generatedBlock: string): { changed: boolean; newContent: string } {
    const text = fs.readFileSync(TARGET_FILE, "utf8");
    const beginIdx = text.indexOf(BEGIN_MARKER);
    const endIdx = text.indexOf(END_MARKER);
    if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
        throw new Error(`${TARGET_FILE} is missing BEGIN/END GENERATED markers`);
    }
    const before = text.slice(0, beginIdx + BEGIN_MARKER.length);
    const after = text.slice(endIdx);
    const newContent = `${before}\n${generatedBlock}\n${after}`;
    return { changed: newContent !== text, newContent };
}

function main(): void {
    const checkMode = process.argv.includes("--check");
    const block = generateBlocklist();
    const { changed, newContent } = rewriteTargetFile(block);

    if (checkMode) {
        if (changed) {
            console.error(
                `ES_LIB_BLOCKLIST in ${path.relative(REPO_ROOT, TARGET_FILE)} is out of sync with the current TypeScript lib.`,
            );
            console.error("Re-run: pnpm regen:td-blocklist");
            process.exit(1);
        }
        console.log("ES_LIB_BLOCKLIST is up to date.");
        return;
    }

    if (changed) {
        fs.writeFileSync(TARGET_FILE, newContent);
        console.log(`Updated ${path.relative(REPO_ROOT, TARGET_FILE)}.`);
    } else {
        console.log("ES_LIB_BLOCKLIST already up to date.");
    }
}

main();
