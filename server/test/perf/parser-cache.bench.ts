/**
 * Measures the tree-sitter parser cache under a realistic tab-switching workload.
 * Reads real TP2/TPH source files and cycles through them at two cache sizes.
 * At size=10 with more than 10 distinct texts, re-parses miss and rebuild trees;
 * at size=64 they all fit and hit.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { bench, describe } from "vitest";
import { createCachedParserModule } from "../../src/shared/parser-factory";

const ROOT_DIR = resolve(__dirname, "../../..");
const IE_FIXTURES = join(ROOT_DIR, "external/infinity-engine");
const GRAMMAR_SAMPLES = join(ROOT_DIR, "grammars/weidu-tp2/test/samples");

function walkForTp2(dir: string, out: string[]): void {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        const s = statSync(p);
        if (s.isDirectory()) walkForTp2(p, out);
        else if (/\.(tp2|tph)$/i.test(entry)) out.push(p);
    }
}

function loadTexts(): string[] {
    const paths: string[] = [];
    if (existsSync(IE_FIXTURES)) walkForTp2(IE_FIXTURES, paths);
    // Always include the committed grammar samples so the bench has input even
    // without external/ fetched.
    if (existsSync(GRAMMAR_SAMPLES)) walkForTp2(GRAMMAR_SAMPLES, paths);
    // Dedupe by content identity and pick the first 20 distinct texts.
    const seen = new Set<string>();
    const texts: string[] = [];
    for (const p of paths) {
        const t = readFileSync(p, "utf-8");
        if (seen.has(t)) continue;
        seen.add(t);
        texts.push(t);
        if (texts.length >= 20) break;
    }
    return texts;
}

const texts = loadTexts();

// Observe results externally so V8 can't dead-code-eliminate the calls.
let sink = 0;

const mod10 = createCachedParserModule("tree-sitter-weidu_tp2.wasm", "TP2-10", 10);
const mod64 = createCachedParserModule("tree-sitter-weidu_tp2.wasm", "TP2-64", 64);

// Top-level await: vitest bench runs bench() bodies in a context where
// beforeAll() state does not reliably carry over. Initialize at module load
// and warm both caches before any bench function fires.
if (texts.length >= 11) {
    await mod10.init();
    await mod64.init();
    for (const t of texts) {
        mod10.parseWithCache(t);
        mod64.parseWithCache(t);
    }
}

describe.skipIf(texts.length < 11)("parser cache throughput (real TP2 fixtures)", () => {

    bench(`size=10, ${texts.length} texts x 1 cycle`, () => {
        for (const t of texts) sink += mod10.parseWithCache(t)?.rootNode.childCount ?? 0;
    });

    bench(`size=64, ${texts.length} texts x 1 cycle`, () => {
        for (const t of texts) sink += mod64.parseWithCache(t)?.rootNode.childCount ?? 0;
    });
});

// Keep sink reachable so the optimizer can't drop the writes.
export { sink };
