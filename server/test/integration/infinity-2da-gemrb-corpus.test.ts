/**
 * Formats every real `.2da` file and asserts GemRB and WeiDU read the result exactly as they read the original
 * with trailing whitespace trimmed. Trimming is the one change of reading the formatter makes on purpose: GemRB
 * reads trailing spaces after the column names as one more, empty, column, and a line of only spaces as a row.
 * `shared/gemrb-2da-reader.ts` is GemRB's reader; WeiDU splits on newline runs, then each line on whitespace runs.
 *
 * Requires external repos (`pnpm test:external`); skips cleanly when the Infinity Engine corpus is not checked out.
 */

import { readFileSync } from "node:fs";
import * as fg from "fast-glob";
import { describe, expect, it } from "vitest";
import { format2da } from "@bgforge/format";
import { readLikeGemrb } from "../shared/gemrb-2da-reader";
import { IE_FIXTURES } from "./test-helpers";

const files = fg.sync("**/*.2da", { cwd: IE_FIXTURES, absolute: true, caseSensitiveMatch: false }).sort();

function readLikeWeidu(text: string): string[][] {
    return text
        .split(/[\r\n]+/)
        .filter((line) => line.length > 0)
        .map((line) => line.split(/[ \t]+/).filter((cell) => cell.length > 0));
}

function trimLines(text: string): string {
    return text
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n");
}

describe.skipIf(files.length === 0)("infinity-2da corpus: formatting keeps GemRB's and WeiDU's reading", () => {
    it(`keeps every file's reading (${files.length} files)`, () => {
        const refused: string[] = [];
        const gemrbChanged: string[] = [];
        const weiduChanged: string[] = [];
        let changed = 0;
        for (const file of files) {
            const text = readFileSync(file, "latin1");
            const result = format2da(text);
            const name = file.slice(IE_FIXTURES.length + 1);
            if (result.warning !== undefined) refused.push(`${name}: ${result.warning}`);
            if (result.text === text) continue;
            changed++;
            const trimmed = trimLines(text);
            if (JSON.stringify(readLikeGemrb(trimmed)) !== JSON.stringify(readLikeGemrb(result.text))) {
                gemrbChanged.push(name);
            }
            if (JSON.stringify(readLikeWeidu(trimmed)) !== JSON.stringify(readLikeWeidu(result.text))) {
                weiduChanged.push(name);
            }
        }
        expect({ refused, gemrbChanged, weiduChanged }).toEqual({ refused: [], gemrbChanged: [], weiduChanged: [] });
        // A sweep that formatted nothing compared nothing.
        expect(changed).toBeGreaterThan(files.length / 4);
    });
});
