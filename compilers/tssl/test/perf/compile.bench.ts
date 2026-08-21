/**
 * Where a TSSL compile spends its time.
 *
 * A CPU profile of the cold path puts ~60% of it inside TypeScript's own scanner, parser and binder,
 * and under 2% in this package - so a bench of the whole compile measures ts-morph, and a regression in
 * the lowering walk would hide inside its noise. The cases below separate the two: the cold ones track
 * the cost a user actually waits for, and `back end alone` tracks the code this package owns.
 *
 * Manual and local, like the server's benches - wall-clock thresholds on a shared runner would fail on
 * load rather than on a regression, so nothing here gates CI.
 */
import * as fs from "fs";
import * as path from "path";
import { bench, describe } from "vitest";
import { emitProgram } from "../../../ssl/src/compile";
import { optimize } from "../../../ssl/src/optimize";
import { createBatchState } from "../../src/batch";
import { lowerTsslProgram } from "../../src/int/lower";

const ROOT = path.resolve(__dirname, "../../../..");
const options = { level: 2, shortCircuit: true } as const;

// Observed externally so V8 cannot drop the calls as dead.
let sink = 0;

/**
 * A source with no imports, so it measures the TypeScript setup a compile cannot avoid without the
 * library closure a real script pulls in. Generated rather than committed as a fixture: the shape that
 * matters is its size, and a literal file of this length is a maintenance burden with no reader.
 */
function selfContainedSource(procedures: number): string {
    const body = Array.from(
        { length: procedures },
        (_, i) => `
export function proc_${i}(): number {
    let total = ${i};
    if (total > 2) {
        total = total + 1;
    } else {
        total = total - 1;
    }
    while (total > 0) {
        total = total - 1;
    }
    return total;
}`,
    ).join("\n");
    return `${body}\nexport function start(): void {\n    let n = proc_0();\n    n = n + 1;\n}\n`;
}

const syntheticPath = path.join(__dirname, "synthetic.tssl");
const synthetic = selfContainedSource(20);

describe("cold compile - one fresh ts-morph project, as the editor and the CLI do it today", () => {
    bench("self-contained source, 20 procedures", () => {
        sink += lowerTsslProgram(syntheticPath, synthetic).declarations.length;
    });
});

// The real corpus lives in gitignored external/, restored by `pnpm test:external`. Its scripts import
// folib, so they are the only inputs here that pay for resolving a library closure.
const CORPUS = path.join(ROOT, "external/fallout/FO2tweaks/source");
const corpusFile = path.join(CORPUS, "gl_g_healing_revision.tssl");
const corpusText = fs.existsSync(corpusFile) ? fs.readFileSync(corpusFile, "utf-8") : "";

describe.skipIf(corpusText === "")("cold compile - real script, with its library closure", () => {
    bench(`gl_g_healing_revision.tssl (${corpusText.split("\n").length} lines)`, () => {
        sink += lowerTsslProgram(corpusFile, corpusText).declarations.length;
    });
});

describe.skipIf(corpusText === "")("warm compile - real script, on a project that was kept", () => {
    const batch = createBatchState();
    lowerTsslProgram(corpusFile, corpusText, batch);

    bench(`gl_g_healing_revision.tssl (${corpusText.split("\n").length} lines)`, () => {
        sink += lowerTsslProgram(corpusFile, corpusText, batch).declarations.length;
    });
});

describe("warm compile - the same document again, on a project that was kept", () => {
    // What the editor does between keystrokes, and what the CLI does from its second file on. The
    // project is built here rather than in the first iteration so the bench measures the steady state.
    const batch = createBatchState();
    lowerTsslProgram(syntheticPath, synthetic, batch);

    bench("self-contained source, 20 procedures", () => {
        sink += lowerTsslProgram(syntheticPath, synthetic, batch).declarations.length;
    });
});

describe("back end alone - this package's IR through the optimiser and the emitter", () => {
    const program = lowerTsslProgram(syntheticPath, synthetic);

    bench("optimize + emitProgram, 20 procedures", () => {
        sink += emitProgram(optimize(program, options), options).length;
    });

    bench("optimize only, 20 procedures", () => {
        sink += optimize(program, options).declarations.length;
    });
});

export { sink };
