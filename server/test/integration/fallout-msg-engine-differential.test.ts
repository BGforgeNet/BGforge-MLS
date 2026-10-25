/**
 * Differential over every real `.msg` file: the game's own loader (`shared/msg-engine-loader.ts`) is the
 * authority, so for each file
 *   - the grammar reports no syntax error exactly when the game loads the file, and
 *   - when it loads, the translation index holds exactly the entries the game loads.
 * A divergence either way is a defect: a diagnostic on a file that loads, silence on one that does not, or a
 * hover that shows text the game never reads (or misses text it does).
 *
 * Requires external repos (`pnpm test:external`); skips cleanly when the Fallout corpus is not checked out.
 * The small set of hand-written cases, which runs without the corpus, is `shared/fallout-msg-engine-agreement`.
 */

import { readFileSync } from "node:fs";
import * as fg from "fast-glob";
import { beforeAll, describe, expect, it } from "vitest";
import * as falloutMsg from "@bgforge/shared/parsers/fallout-msg";
import { parseEntries } from "../../src/translation/entries";
import { loadMsgLikeEngine } from "../shared/msg-engine-loader";
import { FALLOUT_FIXTURES } from "./test-helpers";

const files = fg.sync("**/*.msg", { cwd: FALLOUT_FIXTURES, absolute: true, caseSensitiveMatch: false }).sort();

describe.skipIf(files.length === 0)("fallout-msg corpus: grammar and index against the game's loader", () => {
    beforeAll(async () => {
        await falloutMsg.initParser();
    });

    it(`agrees with the loader on every file (${files.length} files)`, () => {
        const parser = falloutMsg.getParser();
        const grammarVerdictWrong: string[] = [];
        const indexWrong: string[] = [];
        let loaded = 0;
        for (const file of files) {
            const text = readFileSync(file, "latin1");
            const engine = loadMsgLikeEngine(text);
            // Parse with the raw parser and delete each tree immediately: a 13k-file sweep through the cached
            // parse would leak the evicted trees' WASM memory.
            const tree = parser.parse(text);
            const grammarClean = tree !== null && !tree.rootNode.hasError;
            tree?.delete();
            const name = file.slice(FALLOUT_FIXTURES.length + 1);
            if (grammarClean !== engine.ok) grammarVerdictWrong.push(`${name} (loads: ${String(engine.ok)})`);
            if (!engine.ok) continue;
            loaded++;
            const indexed = parseEntries(text, "msg");
            const same =
                indexed.size === engine.entries.size &&
                [...engine.entries.values()].every(
                    (entry) => indexed.get(String(entry.number))?.source.replaceAll("\n", "") === entry.text,
                );
            if (!same) indexWrong.push(name);
        }
        expect({ grammarVerdictWrong, indexWrong }).toEqual({ grammarVerdictWrong: [], indexWrong: [] });
        // A sweep that judged nothing agrees with everything.
        expect(loaded).toBeGreaterThan(files.length / 2);
    });
});
