/**
 * Drift guard for path, symbol and command references in the tracked docs.
 *
 * Docs cite source-file paths, function names and command ids. When code is renamed, moved or deleted,
 * those citations rot into dangling pointers - a whole `dialog-tree/` -> `dialog-editor/` rename once
 * left the architecture doc describing files that no longer existed, and the lsp-api doc described a
 * `workspace/symbol` encoding and custom methods the server never implemented. This test pins every
 * backticked source path to `git ls-files`, every backticked `name()` to a word in tracked code, and
 * every backticked bgforge command id to a real code usage.
 *
 * It catches a NAME that stopped existing, never a relationship that changed (a doc saying module A
 * calls B, after A stopped): that class is kept down by docs pointing at module docstrings rather than
 * restating them.
 *
 * The extractors are deliberately conservative (a guard that false-positives on a correct doc trains
 * readers to ignore it): a path is checked only when it is anchored at the repo root or at the doc's own
 * directory, and globs, placeholders and build-output paths are skipped.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

const trackedFiles = new Set(
    execSync("git ls-files", { encoding: "utf8", timeout: SPAWN_TIMEOUT_MS }).split("\n").filter(Boolean),
);
const trackedDirs = new Set<string>();
for (const file of trackedFiles) {
    for (let dir = path.posix.dirname(file); dir !== "."; dir = path.posix.dirname(dir)) trackedDirs.add(dir);
}

/**
 * Every tracked markdown file except those whose job is to name code that is not there: changelogs record
 * what was removed, and docs/todo.md describes code not yet written. Symlinks (each CLAUDE.md) would only
 * re-check the AGENTS.md they point at.
 */
const DOCS = [...trackedFiles].filter(
    (f) =>
        f.endsWith(".md") &&
        !/(^|\/)changelog\.md$/i.test(f) &&
        f !== "docs/todo.md" &&
        // A tracked doc deleted but not yet staged is still listed; skip it rather than fail the whole project.
        fs.existsSync(f) &&
        !fs.lstatSync(f).isSymbolicLink(),
);

/** Paths a doc cites precisely because they do not exist - recorded non-additions. */
const INTENTIONALLY_ABSENT: Readonly<Record<string, readonly string[]>> = {
    "docs/supply-chain.md": [".github/dependabot.yml"],
};

// Every line mentioning "bgforge" across tracked non-markdown files - contains each command id / method
// literal the code actually uses (protocol constants, package.json contributions, source registrations).
// All markdown is excluded, not just docs/, since every markdown file is itself a checked doc.
const codeMentions = execSync("git grep -hF bgforge -- ':!*.md'", {
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
});

// Every identifier-shaped word in tracked code. Markdown is excluded so a doc cannot vouch for itself, and
// data files and the lockfile so a name surviving only as a string there does not count as code.
const codeWords = new Set(
    // Not piped through `sort -u`: a pipe would report sort's exit status and hide a failed git grep.
    execSync("git grep -hoE '[A-Za-z_$][A-Za-z0-9_$]*' -- ':!*.md' ':!*.json' ':!*.yml' ':!*.yaml'", {
        encoding: "utf8",
        timeout: SPAWN_TIMEOUT_MS,
        maxBuffer: 256 * 1024 * 1024,
    }).split("\n"),
);

/** All backticked inline-code spans in a markdown file, outside fenced blocks. */
function backtickedTokens(text: string): string[] {
    const out: string[] = [];
    for (const m of text.replaceAll(/```[\s\S]*?```/g, "").matchAll(/`([^`\n]+)`/g)) {
        if (m[1] !== undefined) out.push(m[1]);
    }
    return out;
}

const SOURCE_EXT = /\.(ts|mts|svelte|scm|sh|mjs|js|css|json|yml|yaml|py)$/;
const OUTPUT_OR_DEP = /(^|\/)out\/|(^|\/)node_modules\//;

/** A backticked token shaped like a source path, whether or not this guard can anchor it. */
function looksLikeSourcePath(tok: string): boolean {
    return tok.includes("/") && SOURCE_EXT.test(tok);
}

/**
 * The tracked paths a token could mean, or null when it is not a path claim this guard checks: it must end
 * in a source extension, carry no glob/placeholder metachars, not point into build output or dependencies,
 * and its FIRST segment must be a real directory at the repo root or beside the doc. Anchoring on the first
 * segment rather than the parent is what catches a renamed directory: a doc still citing
 * `client/src/dialog-tree/panel.ts` anchors on `client` and fails, where a parent-directory anchor would skip
 * it because `client/src/dialog-tree` no longer exists. A leading `./` is dropped and anchored the same way,
 * since prose uses it for "from the repo root" (`./scripts/x.sh`) as often as for "beside this file".
 */
function pathCandidates(doc: string, tok: string): string[] | null {
    if (!looksLikeSourcePath(tok) || /[*{}<>|\s$]/.test(tok) || OUTPUT_OR_DEP.test(tok)) return null;
    const bare = tok.startsWith("./") ? tok.slice(2) : tok;
    const first = bare.split("/")[0] ?? "";
    const docDir = path.posix.dirname(doc);
    const candidates: string[] = [];
    if (trackedDirs.has(first)) candidates.push(bare);
    if (docDir !== "." && trackedDirs.has(path.posix.join(docDir, first))) {
        candidates.push(path.posix.normalize(path.posix.join(docDir, bare)));
    }
    return candidates.length > 0 ? candidates : null;
}

/**
 * Entries of a file tree drawn in a fenced block: a column-0 line naming a tracked directory (`binary/src/`)
 * roots the tree, and each two-space-indented line lists entries under it (`index.ts`, `spec/`, or several
 * separated by spaces or commas), with anything after `#` a comment. Deeper-indented lines are comment
 * continuations. Globs and placeholders (`presentation-schema*.ts`, `<format>/`) are skipped, as inline.
 */
function treeEntries(text: string): string[] {
    const out: string[] = [];
    for (const block of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
        let root: string | undefined;
        for (const line of (block[1] ?? "").split("\n")) {
            const rootMatch = /^([\w.-]+(?:\/[\w.-]+)*)\/\s*(?:#.*)?$/.exec(line);
            if (rootMatch?.[1] !== undefined) {
                root = trackedDirs.has(rootMatch[1]) ? rootMatch[1] : undefined;
                continue;
            }
            if (root === undefined || !/^ {2}\S/.test(line)) continue;
            const listed = (line.split("#")[0] ?? "").split(/[\s,]+/).filter(Boolean);
            for (const entry of listed) {
                if (/[*{}<>]/.test(entry)) continue;
                out.push(`${root}/${entry}`);
            }
        }
    }
    return out;
}

// A function or method cited as `name()` or `obj.name()`; the last identifier is the one checked.
const SYMBOL_RE = /^(?:[A-Za-z_$][\w$]*\.)*([A-Za-z_$][\w$]*)\(\)$/;

// bgforge / bgforge-mls command and method ids the docs may cite.
const COMMAND_RE = /^(bgforge\.[\w.-]+|extension\.bgforge\.[\w.-]+|bgforge-mls\/[\w.-]+)$/;
function commandIsKnown(cmd: string): boolean {
    if (codeMentions.includes(cmd)) return true;
    // Scoped executeCommand ids are built from a prefix constant plus a runtime
    // suffix (e.g. bgforge.workspaceSymbols.weidu-d from "bgforge.workspaceSymbols.").
    // Accept a cited id whose parent prefix appears as a quoted literal in code.
    const prefix = cmd.slice(0, cmd.lastIndexOf(".") + 1);
    return prefix.length > 0 && codeMentions.includes(`"${prefix}"`);
}

const claims = DOCS.map((doc) => {
    const text = fs.readFileSync(doc, "utf8");
    const tokens = [...new Set(backtickedTokens(text))];
    const absent = INTENTIONALLY_ABSENT[doc] ?? [];
    return {
        doc,
        treeEntries: [...new Set(treeEntries(text))],
        paths: tokens.flatMap((tok) => {
            const candidates = absent.includes(tok) ? null : pathCandidates(doc, tok);
            return candidates ? [{ tok, candidates }] : [];
        }),
        symbols: tokens.flatMap((tok) => {
            const name = SYMBOL_RE.exec(tok)?.[1];
            return name === undefined ? [] : [{ tok, name }];
        }),
        commands: tokens.filter((t) => COMMAND_RE.test(t)),
        // Path-shaped tokens no anchor reaches (globs, placeholders, shorthand like `core/x.ts`), counted so
        // a shrinking guard shows up in the run instead of passing silently.
        skippedPaths: tokens.filter((t) => looksLikeSourcePath(t) && !absent.includes(t) && !pathCandidates(doc, t)),
    };
});
const checkedPathCount = claims.flatMap((c) => c.paths).length;
const skippedPathCount = claims.flatMap((c) => c.skippedPaths).length;

describe("doc references resolve", () => {
    for (const { doc, treeEntries: entries, paths, symbols, commands } of claims) {
        it.each(entries)(`${doc}: file-tree entry %s exists`, (entry) => {
            const exists = entry.endsWith("/") ? trackedDirs.has(entry.slice(0, -1)) : trackedFiles.has(entry);
            expect(exists, `${doc} draws ${entry} in a file tree, but it is not tracked`).toBe(true);
        });

        it.each(paths)(`${doc}: source path $tok is tracked`, ({ tok, candidates }) => {
            expect(
                candidates.some((c) => trackedFiles.has(c)),
                `${doc} cites ${tok}, which is not a tracked file`,
            ).toBe(true);
        });

        it.each(symbols)(`${doc}: symbol $tok appears in code`, ({ tok, name }) => {
            expect(codeWords.has(name), `${doc} cites ${tok}, but no tracked code mentions ${name}`).toBe(true);
        });

        it.each(commands)(`${doc}: command %s is used in code`, (cmd) => {
            expect(commandIsKnown(cmd), `${doc} cites command ${cmd}, absent from tracked source`).toBe(true);
        });
    }

    it(`actually checked some references: ${checkedPathCount} source paths checked, ${skippedPathCount} path-shaped tokens skipped as unanchored`, () => {
        expect(checkedPathCount).toBeGreaterThan(skippedPathCount);
        expect(claims.flatMap((c) => c.treeEntries).length).toBeGreaterThan(0);
        expect(claims.flatMap((c) => c.symbols).length).toBeGreaterThan(0);
        expect(claims.flatMap((c) => c.commands).length).toBeGreaterThan(0);
    });

    it("every intentionally-absent path is still absent and still cited", () => {
        for (const [doc, tokens] of Object.entries(INTENTIONALLY_ABSENT)) {
            const cited = backtickedTokens(fs.readFileSync(doc, "utf8"));
            for (const tok of tokens) {
                expect(trackedFiles.has(tok), `${tok} now exists; drop it from INTENTIONALLY_ABSENT`).toBe(false);
                expect(cited, `${doc} no longer cites ${tok}; drop it from INTENTIONALLY_ABSENT`).toContain(tok);
            }
        }
    });
});
