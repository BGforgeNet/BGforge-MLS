/**
 * Grammar-vs-real-corpus parse sweep.
 *
 * Parses every file of each tree-sitter grammar's language across the real external mod corpora
 * (external/fallout, external/infinity-engine) and asserts the set of files whose parse tree
 * contains an ERROR node exactly matches a committed allowlist. A grammar that regresses to reject
 * a previously-valid file (or newly parses a previously-broken one) fails here.
 *
 * This suite exists because a grammar's own corpus tests use hand-written fixtures, so a real-world
 * construct the fixtures happen to omit can be rejected in the field with no test catching it - which
 * is exactly how the weidu-tra `sound_ref` charset bug shipped. weidu-tra is the primary guard: its
 * allowlist holds only constructs distinct from that fix (see fixtures/known-parse-errors.json). The
 * other grammars carry pre-existing gaps documented in the same allowlist and NOT addressed here.
 *
 * The external corpora are gitignored but reproducible at pinned refs via `pnpm test:external`, so the
 * allowlist is stable. Each grammar's sweep skips cleanly when its corpus is not checked out.
 *
 * Requires external repos (`pnpm test:integration`, which needs `pnpm test:external` first).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Parser } from "web-tree-sitter";
import * as fg from "fast-glob";
import { beforeAll, describe, expect, it } from "vitest";
import { FALLOUT_FIXTURES, IE_FIXTURES } from "./test-helpers";
import * as falloutSsl from "../../../shared/parsers/fallout-ssl";
import * as falloutMsg from "../../../shared/parsers/fallout-msg";
import * as weiduBaf from "../../../shared/parsers/weidu-baf";
import * as weiduD from "../../../shared/parsers/weidu-d";
import * as weiduTp2 from "../../../shared/parsers/weidu-tp2";
import * as weiduTra from "../../../shared/parsers/weidu-tra";

interface ParserModule {
    initParser: () => Promise<void>;
    getParser: () => Parser;
}

interface GrammarSweep {
    readonly name: string;
    readonly mod: ParserModule;
    readonly root: string;
    /**
     * Glob (relative to `root`) matching every source file the grammar owns. Matched case-insensitively: real
     * mods ship uppercase extensions, and a case-sensitive sweep drops those files without reporting a thing.
     */
    readonly glob: string;
}

const GRAMMARS: readonly GrammarSweep[] = [
    { name: "fallout-ssl", mod: falloutSsl, root: FALLOUT_FIXTURES, glob: "**/*.ssl" },
    { name: "fallout-msg", mod: falloutMsg, root: FALLOUT_FIXTURES, glob: "**/*.msg" },
    { name: "weidu-baf", mod: weiduBaf, root: IE_FIXTURES, glob: "**/*.baf" },
    { name: "weidu-d", mod: weiduD, root: IE_FIXTURES, glob: "**/*.d" },
    { name: "weidu-tp2", mod: weiduTp2, root: IE_FIXTURES, glob: "**/*.{tp2,tpa,tph,tpp}" },
    { name: "weidu-tra", mod: weiduTra, root: IE_FIXTURES, glob: "**/*.tra" },
];

interface AllowEntry {
    readonly reason: string;
    readonly files: readonly string[];
}
const ALLOWLIST: Record<string, AllowEntry> = JSON.parse(
    readFileSync(join(__dirname, "fixtures/known-parse-errors.json"), "utf8"),
);

/** Relative paths (POSIX) of files whose parse tree contains an ERROR node. */
function collectErrorFiles(mod: ParserModule, root: string, absPaths: readonly string[]): string[] {
    const parser = mod.getParser();
    const errs: string[] = [];
    for (const abs of absPaths) {
        // Parse with the raw parser and delete each tree immediately: sweeping ~19k files through the
        // 64-entry LRU in parseWithCache would leak the evicted trees' WASM memory.
        const tree = parser.parse(readFileSync(abs, "utf8"));
        if (!tree) continue;
        if (tree.rootNode.hasError) errs.push(abs.slice(root.length + 1));
        tree.delete();
    }
    return errs.sort();
}

describe("grammar corpus parse sweep", () => {
    for (const g of GRAMMARS) {
        const files = fg.sync(g.glob, { cwd: g.root, absolute: true, caseSensitiveMatch: false }).sort();
        const allowed = [...(ALLOWLIST[g.name]?.files ?? [])].sort();

        describe.skipIf(files.length === 0)(g.name, () => {
            beforeAll(async () => {
                await g.mod.initParser();
            });

            it(`parses the corpus with only the allowlisted files erroring (${files.length} files)`, () => {
                const actual = collectErrorFiles(g.mod, g.root, files);
                const newErrors = actual.filter((f) => !allowed.includes(f));
                const nowClean = allowed.filter((f) => !actual.includes(f));
                expect(
                    { newErrors, nowClean },
                    `${g.name}: parse-error set drifted from the allowlist.\n` +
                        `  newErrors (regressions - files that now fail): ${JSON.stringify(newErrors)}\n` +
                        `  nowClean (files that no longer error - update the allowlist): ${JSON.stringify(nowClean)}`,
                ).toEqual({ newErrors: [], nowClean: [] });
            });
        });
    }
});
