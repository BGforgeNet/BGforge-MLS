/**
 * Measures the dialog parsers against the cost they exist to avoid.
 *
 * Both run on the server thread for every dialog-editor read. Each holds a reused ts-morph project,
 * so a repeated parse skips program construction; the "from scratch" arms below are the same work
 * with a fresh project per call, which is what these parsers did before. The gap between the two
 * arms is the whole point, and it is what `dialog-source-project-reuse.test.ts` guards as a ratio.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bench, describe, vi } from "vitest";
import { Project } from "ts-morph";
import { parseTDSource } from "../../src/td/dialog-source";
import { parseTSSLSource } from "../../src/tssl/dialog-source";

// The syntax-error degrade logs through the LSP connection, which benches never initialize.
vi.mock("../../src/logger", () => ({ conlog: vi.fn() }));

const sample = (rel: string): string => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

const TD_SOURCE = sample("td/samples/familiars_v2.td");
const TSSL_SOURCE = sample("tssl/samples/flat.tssl");

/** What each parser did before: a fresh project, so every call pays the binder again. */
function parseFromScratch(text: string): number {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile("scratch.ts", text);
    return project.getProgram().getSyntacticDiagnostics(sf).length;
}

let sink = 0;

describe("TD dialog source", () => {
    bench("reused project (shipped)", () => {
        sink += parseTDSource(TD_SOURCE).states.length;
    });

    bench("fresh project per call (pre-reuse baseline)", () => {
        sink += parseFromScratch(TD_SOURCE);
    });
});

describe("TSSL dialog source", () => {
    bench("reused project (shipped)", () => {
        sink += parseTSSLSource(TSSL_SOURCE).nodes.length;
    });

    bench("fresh project per call (pre-reuse baseline)", () => {
        sink += parseFromScratch(TSSL_SOURCE);
    });
});

// Keep sink reachable so the optimizer can't drop the writes.
export { sink };
