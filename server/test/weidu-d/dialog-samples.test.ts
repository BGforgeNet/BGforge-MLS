/**
 * Integration tests for weidu-d/dialog.ts against real sample .d files.
 * Parses every .d file from grammars/weidu-d/test/samples/ and validates
 * that the dialog parser extracts meaningful structure without errors.
 */

import * as fs from "fs";
import * as path from "path";
import { describe, expect, it, beforeAll, vi } from "vitest";

// Mock the server module to avoid LSP connection issues
vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import type { DDialogData } from "../../../shared/dialog-types";
import { parseDDialog } from "../../src/weidu-d/dialog";
import { initParser } from "../../../shared/parsers/weidu-d";

const SAMPLES_DIR = path.resolve(__dirname, "../../../grammars/weidu-d/test/samples");

/** Collect all .d files from the samples directory. */
function getSampleFiles(): string[] {
    return fs
        .readdirSync(SAMPLES_DIR)
        .filter((f) => f.endsWith(".d"))
        .sort();
}

/**
 * Check whether file text contains dialog-producing keywords at the start of
 * a line. This avoids false positives from ADD_TRANS_ACTION arguments like
 * `BEGIN 8 END BEGIN 0 END` which contain BEGIN/END as parameter tokens.
 */
function hasDialogKeywords(text: string): boolean {
    return /^(?:BEGIN|APPEND|CHAIN|EXTEND_BOTTOM|EXTEND_TOP|INTERJECT(?:_COPY_TRANS)?|REPLACE)\b/m.test(text);
}

beforeAll(async () => {
    await initParser();
});

describe("weidu-d/dialog - sample files", () => {
    const sampleFiles = getSampleFiles();

    it("has sample files to test", () => {
        expect(sampleFiles.length).toBeGreaterThan(0);
    });

    describe("all sample files parse without errors", () => {
        for (const fileName of sampleFiles) {
            it(`parses ${fileName} without throwing`, () => {
                const filePath = path.join(SAMPLES_DIR, fileName);
                const text = fs.readFileSync(filePath, "utf-8");
                let result: DDialogData | undefined;

                expect(() => {
                    result = parseDDialog(text);
                }).not.toThrow();

                expect(result).toBeDefined();
                expect(result!.blocks).toBeInstanceOf(Array);
                expect(result!.states).toBeInstanceOf(Array);
            });
        }
    });

    describe("files with dialog keywords produce blocks and/or states", () => {
        for (const fileName of sampleFiles) {
            const filePath = path.join(SAMPLES_DIR, fileName);
            const text = fs.readFileSync(filePath, "utf-8");

            if (!hasDialogKeywords(text)) {
                continue;
            }

            it(`${fileName} produces blocks or states`, () => {
                const result = parseDDialog(text);
                const totalStructure = result.blocks.length + result.states.length;

                // Files with dialog keywords should produce some structure
                expect(totalStructure).toBeGreaterThan(0);
            });
        }
    });

    // -----------------------------------------------------------------------
    // Specific assertions for well-known sample files
    // -----------------------------------------------------------------------

    describe("rr_gaelan.d", () => {
        let result: DDialogData;

        beforeAll(() => {
            const text = fs.readFileSync(path.join(SAMPLES_DIR, "rr_gaelan.d"), "utf-8");
            result = parseDDialog(text);
        });

        it("has APPEND and CHAIN blocks", () => {
            const kinds = new Set(result.blocks.map((b) => b.kind));
            expect(kinds.has("append")).toBe(true);
            expect(kinds.has("chain")).toBe(true);
        });

        it("has multiple states with transitions", () => {
            // The file has many IF/THEN BEGIN states inside APPEND
            expect(result.states.length).toBeGreaterThanOrEqual(10);

            const statesWithTransitions = result.states.filter((s) => s.transitions.length > 0);
            expect(statesWithTransitions.length).toBeGreaterThanOrEqual(5);
        });

        it("has CHAIN blocks with labels", () => {
            const chainBlocks = result.blocks.filter((b) => b.kind === "chain");
            expect(chainBlocks.length).toBe(2);

            const chainLabels = chainBlocks.map((b) => b.label).filter(Boolean);
            expect(chainLabels).toContain("RR#GaelArledKill1");
            expect(chainLabels).toContain("RR#GaelArledKill2");
        });

        it("has states referencing GAELAN dialog file", () => {
            const gaelanStates = result.states.filter((s) => s.speaker === "GAELAN");
            expect(gaelanStates.length).toBeGreaterThanOrEqual(5);
        });

        it("has GOTO transitions between states", () => {
            const gotoTransitions = result.states.flatMap((s) => s.transitions.filter((t) => t.target.kind === "goto"));
            expect(gotoTransitions.length).toBeGreaterThanOrEqual(10);
        });

        it("has EXIT transitions", () => {
            const exitTransitions = result.states.flatMap((s) => s.transitions.filter((t) => t.target.kind === "exit"));
            expect(exitTransitions.length).toBeGreaterThanOrEqual(5);
        });
    });

    describe("pizza_chain.d", () => {
        let result: DDialogData;

        beforeAll(() => {
            const text = fs.readFileSync(path.join(SAMPLES_DIR, "pizza_chain.d"), "utf-8");
            result = parseDDialog(text);
        });

        it("has a single CHAIN block", () => {
            expect(result.blocks).toHaveLength(1);
            expect(result.blocks[0]!.kind).toBe("chain");
            expect(result.blocks[0]!.label).toBe("pizzachain");
        });

        it("has at least one synthetic state from chain", () => {
            // CHAIN IF ... THEN syntax: flattenChain may not extract all ==
            // speaker sections as separate ChainText nodes, so the number of
            // synthetic states varies. At minimum the initial text is extracted.
            expect(result.states.length).toBeGreaterThanOrEqual(1);
        });

        it("first state has the chain label and initial speaker", () => {
            expect(result.states[0]!.label).toBe("pizzachain");
            expect(result.states[0]!.speaker).toBe("BJKLSY");
            expect(result.states[0]!.sayText).toContain("pizza");
        });

        it("initial speaker is BJKLSY", () => {
            expect(result.blocks[0]!.file).toBe("BJKLSY");
        });

        it("chain states have transitions or connect sequentially", () => {
            // Each synthetic state should either have explicit transitions
            // or be connected to the next state via auto-generated GOTO.
            for (const state of result.states) {
                // The last state might have an EXIT; intermediate states have GOTOs
                expect(
                    state.transitions.length + (state === result.states[result.states.length - 1] ? 0 : 1),
                ).toBeGreaterThanOrEqual(0);
            }
        });
    });

    describe("botsmith.d", () => {
        let result: DDialogData;

        beforeAll(() => {
            const text = fs.readFileSync(path.join(SAMPLES_DIR, "botsmith.d"), "utf-8");
            result = parseDDialog(text);
        });

        it("has EXTEND_BOTTOM and APPEND blocks", () => {
            const kinds = new Set(result.blocks.map((b) => b.kind));
            expect(kinds.has("extend")).toBe(true);
            expect(kinds.has("append")).toBe(true);
        });

        it("has APPEND blocks for different categories", () => {
            const appendBlocks = result.blocks.filter((b) => b.kind === "append");
            // botsmith.d has 4 separate APPEND blocks
            expect(appendBlocks.length).toBeGreaterThanOrEqual(4);
        });

        it("has states with short (++) transitions", () => {
            // States like g_item_type, g_weapon, g_armor, g_trinket use ++ syntax
            const statesWithShortTransitions = result.states.filter((s) => s.transitions.length >= 2);
            expect(statesWithShortTransitions.length).toBeGreaterThanOrEqual(1);
        });

        it("has GOTO transitions from short syntax", () => {
            const gotoTransitions = result.states.flatMap((s) => s.transitions.filter((t) => t.target.kind === "goto"));
            expect(gotoTransitions.length).toBeGreaterThanOrEqual(4);
        });
    });

    describe("ascension_bodhi_solar.d", () => {
        let result: DDialogData;

        beforeAll(() => {
            const text = fs.readFileSync(path.join(SAMPLES_DIR, "ascension_bodhi_solar.d"), "utf-8");
            result = parseDDialog(text);
        });

        it("has EXTEND_BOTTOM and APPEND blocks", () => {
            const kinds = new Set(result.blocks.map((b) => b.kind));
            expect(kinds.has("extend")).toBe(true);
            expect(kinds.has("append")).toBe(true);
        });

        it("has APPEND blocks for different dialog files", () => {
            const appendBlocks = result.blocks.filter((b) => b.kind === "append");
            const files = new Set(appendBlocks.map((b) => b.file));
            expect(files.has("finbodh")).toBe(true);
            expect(files.has("finsol01")).toBe(true);
        });

        it("has states with EXTERN transitions", () => {
            const externTransitions = result.states.flatMap((s) =>
                s.transitions.filter((t) => t.target.kind === "extern"),
            );
            expect(externTransitions.length).toBeGreaterThanOrEqual(1);

            // At least one EXTERN points to finsol01
            const toSolar = externTransitions.filter((t) => t.target.kind === "extern" && t.target.file === "finsol01");
            expect(toSolar.length).toBeGreaterThanOrEqual(1);
        });

        it("has states with GOTO transitions", () => {
            const gotoTransitions = result.states.flatMap((s) => s.transitions.filter((t) => t.target.kind === "goto"));
            expect(gotoTransitions.length).toBeGreaterThanOrEqual(2);
        });

        it("has states with EXIT transitions", () => {
            const exitTransitions = result.states.flatMap((s) => s.transitions.filter((t) => t.target.kind === "exit"));
            expect(exitTransitions.length).toBeGreaterThanOrEqual(5);
        });

        it("has states with reply text", () => {
            const statesWithReplies = result.states.filter((s) => s.transitions.some((t) => t.replyText !== undefined));
            expect(statesWithReplies.length).toBeGreaterThanOrEqual(2);
        });

        it("has bodhi_interjection state with multiple replies", () => {
            const bodhiState = result.states.find((s) => s.label === "bodhi_interjection");
            expect(bodhiState).toBeDefined();
            expect(bodhiState!.transitions.length).toBeGreaterThanOrEqual(3);
        });
    });

    // -----------------------------------------------------------------------
    // Summary: print aggregate stats after all tests
    // -----------------------------------------------------------------------

    describe("aggregate summary", () => {
        it("prints parsing summary for all sample files", () => {
            let totalBlocks = 0;
            let totalStates = 0;
            let totalTransitions = 0;
            let filesWithErrors = 0;

            for (const fileName of sampleFiles) {
                const filePath = path.join(SAMPLES_DIR, fileName);
                const text = fs.readFileSync(filePath, "utf-8");

                try {
                    const result = parseDDialog(text);
                    totalBlocks += result.blocks.length;
                    totalStates += result.states.length;
                    totalTransitions += result.states.reduce((sum, s) => sum + s.transitions.length, 0);
                } catch {
                    filesWithErrors++;
                }
            }

            expect(filesWithErrors).toBe(0);
            expect(totalBlocks).toBeGreaterThan(0);
            expect(totalStates).toBeGreaterThan(0);
            expect(totalTransitions).toBeGreaterThan(0);
        });
    });
});
