/**
 * Comment-rescue sweep over the real external corpora.
 *
 * Formats every Fallout SSL, WeiDU BAF, D and TP2 file of external/fallout and external/infinity-engine (minus the
 * files `external/*-exclude.txt` lists, as `fgfmt -r --exclude-from` does) and asserts that no formatter had to move
 * a comment back because a rebuild path would have dropped it. The formatters report that as a notice on their
 * result; on real files they must keep every comment where it was written.
 *
 * Requires external repos (`pnpm test:integration`, which needs `pnpm test:external` first); skips when absent.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Node as SyntaxNode, Parser } from "web-tree-sitter";
import * as fg from "fast-glob";
import { beforeAll, describe, expect, it } from "vitest";
import {
    formatFalloutSsl,
    formatWeiduBaf,
    formatWeiduD,
    formatWeiduTp2,
    getEditorconfigSettings,
} from "@bgforge/format";
import * as falloutSsl from "@bgforge/shared/parsers/fallout-ssl";
import * as weiduBaf from "@bgforge/shared/parsers/weidu-baf";
import * as weiduD from "@bgforge/shared/parsers/weidu-d";
import * as weiduTp2 from "@bgforge/shared/parsers/weidu-tp2";
import { FALLOUT_FIXTURES, IE_FIXTURES } from "./test-helpers";

interface ParserModule {
    initParser: () => Promise<void>;
    getParser: () => Parser;
}

interface FormatterSweep {
    readonly name: string;
    readonly mod: ParserModule;
    readonly glob: string;
    readonly format: (
        root: SyntaxNode,
        options: { indentSize: number; lineLimit: number },
    ) => { text: string; notice?: string; warning?: string };
}

const FORMATTERS: readonly FormatterSweep[] = [
    { name: "fallout-ssl", mod: falloutSsl, glob: "**/*.ssl", format: formatFalloutSsl },
    { name: "weidu-baf", mod: weiduBaf, glob: "**/*.baf", format: formatWeiduBaf },
    { name: "weidu-d", mod: weiduD, glob: "**/*.d", format: formatWeiduD },
    { name: "weidu-tp2", mod: weiduTp2, glob: "**/*.{tp2,tpa,tph,tpp}", format: formatWeiduTp2 },
];

const TREES = [
    { root: FALLOUT_FIXTURES, excludeList: join(FALLOUT_FIXTURES, "..", "fallout-exclude.txt") },
    { root: IE_FIXTURES, excludeList: join(IE_FIXTURES, "..", "infinity-engine-exclude.txt") },
] as const;

/** The absolute paths an exclusion list names: one per line, relative to the tree, `#` comments and blanks ignored. */
function excluded(tree: (typeof TREES)[number]): Set<string> {
    if (!existsSync(tree.excludeList)) return new Set();
    const lines = readFileSync(tree.excludeList, "utf8").split("\n");
    return new Set(
        lines
            .map((line) => line.trim())
            .filter((line) => line !== "" && !line.startsWith("#"))
            .map((line) => resolve(tree.root, line)),
    );
}

/** Every file of a glob across both trees, case-insensitively as real mods ship uppercase extensions. */
function corpusFiles(glob: string): string[] {
    return TREES.flatMap((tree) => {
        if (!existsSync(tree.root)) return [];
        const skip = excluded(tree);
        return fg
            .sync(glob, { cwd: tree.root, absolute: true, caseSensitiveMatch: false, dot: false })
            .filter((file) => !skip.has(resolve(file)))
            .sort();
    });
}

describe.each(FORMATTERS)("$name comment rescues over the corpus", (sweep) => {
    const files = corpusFiles(sweep.glob);

    beforeAll(async () => {
        await sweep.mod.initParser();
    });

    describe.skipIf(files.length === 0)("with the corpus checked out", () => {
        it("moves no comment back because the formatter would have dropped it", () => {
            const parser = sweep.mod.getParser();
            const rescued: string[] = [];
            for (const file of files) {
                const tree = parser.parse(readFileSync(file, "utf8"));
                if (!tree) throw new Error(`${file}: failed to parse`);
                try {
                    const settings = getEditorconfigSettings(resolve(file));
                    const result = sweep.format(tree.rootNode, {
                        indentSize: settings.indentSize ?? 4,
                        lineLimit: settings.maxLineLength ?? 120,
                    });
                    if (result.notice ?? result.warning) rescued.push(`${file}: ${result.notice ?? result.warning}`);
                } finally {
                    tree.delete();
                }
            }
            // The count carries the total; the list is the first files to look at.
            expect({ files: files.length, rescued: rescued.length, first: rescued.slice(0, 10) }).toEqual({
                files: files.length,
                rescued: 0,
                first: [],
            });
        }, 900_000);
    });
});
