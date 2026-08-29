/**
 * The transpile worker produces exactly what the in-process transpilers produce.
 *
 * `server/src/compile.ts` calls `td` and `tbafWithSourceMap` on the server thread, which is where
 * 80% of the server bundle (ts-morph and the TD/TBAF transpilers) comes from, and where a 51-60 ms
 * cold stall per save comes from. Moving that work to a worker is only safe if the answer is
 * unchanged, so the oracle here is the existing implementation's own output - the intent of the move
 * is "same result, different thread", and any divergence is the defect.
 *
 * The core is exercised directly rather than through a thread, matching the TSSL compile worker's
 * split; `transpile-worker-smoke.test.ts` is what proves the built bundle actually loads and answers.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { td, tbafWithSourceMap } from "../../transpilers/src/index";
import { parseTDSource } from "../src/td/dialog-source";
import { parseTSSLSource } from "../src/tssl/dialog-source";
import { runTranspile } from "../src/transpile/transpile-worker";

const TD_SAMPLE = join(__dirname, "td", "samples", "familiars_v2.td");
const TBAF_SAMPLE = join(__dirname, "tbaf", "samples", "basic_if.tbaf");
const TSSL_SAMPLE = join(__dirname, "tssl", "samples", "flat.tssl");

describe("the transpile worker core", () => {
    it("returns the same TD output as an in-process transpile", async () => {
        const text = readFileSync(TD_SAMPLE, "utf8");

        const expected = await td(TD_SAMPLE, text);
        const actual = await runTranspile({ id: 0, kind: "td", filepath: TD_SAMPLE, text });

        expect(actual.failure).toBeUndefined();
        expect(actual.result?.output).toEqual(expected.output);
        expect(actual.result?.warnings).toEqual(expected.warnings);
        expect(actual.result?.sourceMap).toEqual(expected.sourceMap);
    });

    it("returns the same TBAF output as an in-process transpile", async () => {
        const text = readFileSync(TBAF_SAMPLE, "utf8");

        const expected = await tbafWithSourceMap(TBAF_SAMPLE, text);
        const actual = await runTranspile({ id: 0, kind: "tbaf", filepath: TBAF_SAMPLE, text });

        expect(actual.failure).toBeUndefined();
        expect(actual.result?.output).toEqual(expected.output);
        expect(actual.result?.sourceMap).toEqual(expected.sourceMap);
    });

    // The refusal is thrown as a class the structured clone cannot carry, so the protocol has to
    // flatten it - the same reason the TSSL worker's protocol does, and the same place its position
    // would otherwise be lost. The input is the self-contained refusal `error-positions.test.ts`
    // pins: `alterTrans` naming a state that was never begun, which refuses on line 3.
    it("reports a refusal as plain data, with its position intact", async () => {
        const refused = `export default begin("MYFOO", []);\n\nalterTrans("MYFOO", 1);\n`;

        const actual = await runTranspile({ id: 7, kind: "td", filepath: TD_SAMPLE, text: refused });

        expect(actual.id).toBe(7);
        expect(actual.result).toBeUndefined();
        expect(actual.failure?.message).toContain("alterTrans()");
        expect(actual.failure?.line).toBe(3);
    });
});

// The dialog parsers are the other half of the server thread's ts-morph use, and one importer is enough
// to keep the whole library in the bundle - so they move for the same reason and are pinned the same way.
describe("the dialog parsers on the worker", () => {
    it("returns the same TD dialog model as an in-process parse", async () => {
        const text = readFileSync(TD_SAMPLE, "utf8");

        const expected = parseTDSource(text);
        const actual = await runTranspile({ id: 1, kind: "parse-td", filepath: TD_SAMPLE, text });

        expect(actual.failure).toBeUndefined();
        expect(actual.parsed).toEqual(expected);
    });

    it("returns the same TSSL dialog model as an in-process parse", async () => {
        const text = readFileSync(TSSL_SAMPLE, "utf8");

        // The side-effect set crosses with the request, so the oracle is built from the same set.
        const sideEffectFns = ["give_exp_points", "move_to"];
        const expected = parseTSSLSource(text, new Set(sideEffectFns));
        const actual = await runTranspile({ id: 2, kind: "parse-tssl", filepath: TSSL_SAMPLE, text, sideEffectFns });

        expect(actual.failure).toBeUndefined();
        expect(actual.parsed).toEqual(expected);
    });
});
