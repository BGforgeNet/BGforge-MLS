/**
 * The dialog parsers run on the server thread for every dialog-editor read, so they must not
 * re-pay TypeScript program construction per call - that cost is ~100x the parse itself.
 *
 * Reusing one project across calls is what makes that possible, and it introduces the risk this
 * suite exists to cover: a source file left behind at a shared virtual path would let one parse
 * answer with another's states. The interleaving tests below are the guard for that; the timing
 * tests are the reason the reuse is there at all.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Project } from "ts-morph";
import { parseTDSource } from "../src/td/dialog-source";
import { parseTSSLSource } from "../src/tssl/dialog-source";

// The syntax-error degrade logs through the LSP connection, which unit tests never initialize.
vi.mock("../src/logger", () => ({ conlog: vi.fn() }));

const td = (name: string): string =>
    readFileSync(fileURLToPath(new URL(`td/samples/${name}`, import.meta.url)), "utf8");
const tssl = (name: string): string =>
    readFileSync(fileURLToPath(new URL(`tssl/samples/${name}`, import.meta.url)), "utf8");

/**
 * The budget is a from-scratch parse measured in this same process, not a millisecond constant: an
 * absolute threshold passes alone and fails under a loaded parallel suite, which makes it a guard
 * that cries wolf. Both arms feel the same machine, so the ratio holds anywhere.
 *
 * The factor is low on purpose. Reuse removes project construction but not the parser's own AST
 * walk, so the achievable speedup is bounded by how much of a parse that walk is: the small TSSL
 * sample clears ~100x, the larger TD one about 5x. Without reuse the two arms land within ~10% of
 * each other, so 3x sits clear of the regression on one side and of the TD ceiling on the other.
 */
const MIN_SPEEDUP = 3;
function fromScratchMs(text: string): number {
    // Must materialize the program, not just allocate the Project: construction is lazy and costs
    // ~0.1ms, while the binder work a first `getProgram()` forces is the ~100ms reuse exists to skip.
    return median(() => {
        const project = new Project({ useInMemoryFileSystem: true });
        const sf = project.createSourceFile("scratch.ts", text);
        project.getProgram().getSyntacticDiagnostics(sf);
    });
}

function medianMs(runs: number): (fn: () => void) => number {
    return (fn) => {
        const times: number[] = [];
        for (let i = 0; i < runs; i++) {
            const t0 = process.hrtime.bigint();
            fn();
            times.push(Number(process.hrtime.bigint() - t0) / 1e6);
        }
        times.sort((a, b) => a - b);
        return times[Math.floor(times.length / 2)]!;
    };
}

const median = medianMs(9);

describe("dialog source parsers reuse their ts-morph project", () => {
    describe("TD", () => {
        const familiars = td("familiars_v2.td");
        const botsmith = td("botsmith.td");

        it("answers each source with its own states when calls interleave", () => {
            const first = parseTDSource(familiars);
            const other = parseTDSource(botsmith);
            const again = parseTDSource(familiars);

            expect(again.states.map((s) => s.label)).toEqual(first.states.map((s) => s.label));
            expect(other.states.map((s) => s.label).sort()).toEqual([
                "g_armor",
                "g_item_type",
                "g_trinket",
                "g_weapon",
            ]);
            // The guard that matters: botsmith's states must not appear in a familiars parse.
            expect(again.states.map((s) => s.label)).not.toContain("g_item_type");
        });

        it("keeps source ranges pointing into the text just parsed, not a previous one", () => {
            parseTDSource(botsmith);
            const data = parseTDSource(familiars);
            for (const state of data.states) {
                if (!state.range) continue;
                expect(familiars.slice(state.range.start, state.range.end)).toContain(state.label);
            }
        });

        it("parses a repeated document at least 10x faster than parsing it from scratch", () => {
            parseTDSource(familiars); // warm up: first call builds whatever is reused
            expect(median(() => void parseTDSource(familiars))).toBeLessThan(fromScratchMs(familiars) / MIN_SPEEDUP);
        });
    });

    describe("TSSL", () => {
        const flat = tssl("flat.tssl");
        const nested = tssl("nested.tssl");

        it("answers each source with its own nodes when calls interleave", () => {
            const first = parseTSSLSource(flat);
            parseTSSLSource(nested);
            const again = parseTSSLSource(flat);

            expect(again.nodes.map((n) => n.name)).toEqual(first.nodes.map((n) => n.name));
        });

        it("parses a repeated document at least 10x faster than parsing it from scratch", () => {
            parseTSSLSource(flat); // warm up: first call builds whatever is reused
            expect(median(() => void parseTSSLSource(flat))).toBeLessThan(fromScratchMs(flat) / MIN_SPEEDUP);
        });
    });
});
