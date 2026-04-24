/**
 * Measures parseFile end-to-end on a realistic TP2 source. Task 2 replaces
 * three AST walks with one; this file's numbers are compared before/after.
 *
 * Picks the largest real TP2 file available from external/ if present,
 * otherwise falls back to the committed grammar sample `tnt.tp2`.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bench, describe } from "vitest";
import { parseFile } from "../../src/weidu-tp2/header-parser";
import { initParser } from "../../src/weidu-tp2/parser";

// Top-level await: vitest bench runs bench() bodies in a context where
// beforeAll() state does not reliably carry over. Initialize at module load
// so the parser manager is ready before any bench function fires.
await initParser();

const ROOT_DIR = resolve(__dirname, "../../..");

const CANDIDATE_PATHS = [
    join(ROOT_DIR, "external/infinity-engine/BGT-WeiDU/bgt/bgt.tp2"), // ~12k lines
    join(ROOT_DIR, "external/infinity-engine/rr/rr/setup-rr.tp2"), // ~4.8k lines
    join(ROOT_DIR, "external/infinity-engine/bg2-tweaks-and-tricks/tnt/tnt.tp2"), // ~650 lines
    join(ROOT_DIR, "grammars/weidu-tp2/test/samples/tnt.tp2"), // ~580 lines, always present
];

function pickLargest(): { path: string; text: string } | null {
    let best: { path: string; size: number } | null = null;
    for (const p of CANDIDATE_PATHS) {
        if (!existsSync(p)) continue;
        const size = statSync(p).size;
        if (!best || size > best.size) best = { path: p, size };
    }
    if (!best) return null;
    return { path: best.path, text: readFileSync(best.path, "utf-8") };
}

const picked = pickLargest();

// Observe results externally so V8 can't dead-code-eliminate the calls.
let sink = 0;

describe.skipIf(picked === null)("weidu-tp2 parseFile", () => {
    const uri = picked ? pathToFileURL(picked.path).toString() : "";
    const text = picked?.text ?? "";

    bench(`parseFile — ${picked?.path.split("/").pop()} (${text.split("\n").length} lines)`, () => {
        const r = parseFile(uri, text);
        sink += r.symbols.length + r.refs.size;
    });
});

export { sink };
