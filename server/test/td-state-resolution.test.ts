/**
 * Unit tests for TD state resolution — transitive collection and orphan detection.
 * Tests resolveTransitiveStates, collectOrphanWarnings, detectOrphansFromOriginal,
 * and mergeWarnings.
 */

import { describe, expect, it } from "vitest";
import { Project } from "ts-morph";
import { parse } from "../../transpilers/td/src/parse";
import { emitD } from "../../transpilers/td/src/emit";
import { extractTraTag } from "../../transpilers/common/transpiler-utils";
import type { TDScript } from "../../transpilers/td/src/types";
import { detectOrphansFromOriginal, mergeWarnings } from "../../transpilers/td/src/index";

describe("TD state resolution", () => {
    function parseIR(code: string): TDScript {
        const project = new Project({ useInMemoryFileSystem: true });
        const sourceFile = project.createSourceFile("test.td", code);
        return { ...parse(sourceFile), traTag: extractTraTag(code) };
    }

    function transpile(code: string): string {
        return emitD(parseIR(code));
    }

    // =========================================================================
    // Transitive state collection (Phase 9)
    // =========================================================================

    describe("Transitive state collection", () => {
        it("transitively collects goTo targets not explicitly listed", () => {
            const code = `
function start() {
    say(tra(100));
    reply(tra(101)).goTo(target);
}
function target() {
    say(tra(200));
    exit();
}
begin("DLG", [start]);
`;
            const result = transpile(code);
            expect(result).toContain("IF ~~ start");
            expect(result).toContain("IF ~~ target");
        });

        it("recursively collects transitive targets (a -> b -> c)", () => {
            const code = `
function a() {
    say(tra(100));
    reply(tra(101)).goTo(b);
}
function b() {
    say(tra(200));
    reply(tra(201)).goTo(c);
}
function c() {
    say(tra(300));
    exit();
}
begin("DLG", [a]);
`;
            const result = transpile(code);
            expect(result).toContain("IF ~~ a");
            expect(result).toContain("IF ~~ b");
            expect(result).toContain("IF ~~ c");
        });

        it("skips targets already explicit in another construct", () => {
            const code = `
function a() {
    say(tra(100));
    reply(tra(101)).goTo(shared);
}
function shared() {
    say(tra(200));
    exit();
}
function x() {
    say(tra(300));
    exit();
}
begin("DLG1", [a]);
append("DLG2", [shared, x]);
`;
            const ir = parseIR(code);
            // DLG1 should NOT contain shared (it's explicit in DLG2's append)
            const beginConstruct = ir.constructs.find((c) => c.type === "begin");
            expect(beginConstruct).toBeDefined();
            if (beginConstruct?.type === "begin") {
                const labels = beginConstruct.states.map((s) => s.label);
                expect(labels).not.toContain("shared");
            }
        });

        it("skips numeric goTo targets", () => {
            const code = `
function a() {
    say(tra(100));
    goTo(15);
}
begin("DLG", [a]);
`;
            // Should not throw or try to collect state "15"
            const result = transpile(code);
            expect(result).toContain("IF ~~ a");
            expect(result).toContain("GOTO 15");
        });

        it("skips extern() targets (different dialog)", () => {
            const code = `
function a() {
    say(tra(100));
    reply(tra(101)).extern("OTHER", "s1");
}
begin("DLG", [a]);
`;
            const result = transpile(code);
            expect(result).toContain("EXTERN OTHER s1");
            // Should only have one state
            const ir = parseIR(code);
            if (ir.constructs[0]?.type === "begin") {
                expect(ir.constructs[0]!.states).toHaveLength(1);
            }
        });

        it("does not collect helper functions (called as function)", () => {
            const code = `
function helper() {
    action_drink();
}
function start() {
    say(tra(100));
    helper();
    exit();
}
begin("DLG", [start]);
`;
            const ir = parseIR(code);
            // helper is called as a function, should not be collected as state
            if (ir.constructs[0]?.type === "begin") {
                const labels = ir.constructs[0]!.states.map((s) => s.label);
                expect(labels).not.toContain("helper");
                expect(labels).toContain("start");
            }
            // No orphan warning for helper (it's called as a function)
            expect(ir.warnings ?? []).toHaveLength(0);
        });

        it("does not collect parameterized functions", () => {
            const code = `
function helper(x: number) {
    say(tra(x));
    exit();
}
function start() {
    say(tra(100));
    reply(tra(101)).goTo(helper);
}
begin("DLG", [start]);
`;
            const ir = parseIR(code);
            // helper has parameters, should not be transitively collected
            if (ir.constructs[0]?.type === "begin") {
                const labels = ir.constructs[0]!.states.map((s) => s.label);
                expect(labels).not.toContain("helper");
            }
        });

        it("follows goTo targets from object-form states", () => {
            const code = `
function target() {
    say(tra(200));
    exit();
}
begin("DLG", {
    start() {
        say(tra(100));
        reply(tra(101)).goTo(target);
    }
});
`;
            const result = transpile(code);
            expect(result).toContain("IF ~~ start");
            expect(result).toContain("IF ~~ target");
        });

        it("handles circular goTo references without infinite loop", () => {
            const code = `
function a() {
    say(tra(100));
    reply(tra(101)).goTo(b);
}
function b() {
    say(tra(200));
    reply(tra(201)).goTo(a);
}
begin("DLG", [a]);
`;
            const result = transpile(code);
            expect(result).toContain("IF ~~ a");
            expect(result).toContain("IF ~~ b");
        });

        it("does not duplicate states already explicitly listed", () => {
            const code = `
function start() {
    say(tra(100));
    reply(tra(101)).goTo(target);
}
function target() {
    say(tra(200));
    exit();
}
begin("DLG", [start, target]);
`;
            const ir = parseIR(code);
            if (ir.constructs[0]?.type === "begin") {
                const labels = ir.constructs[0]!.states.map((s) => s.label);
                // target should appear exactly once
                expect(labels.filter((l) => l === "target")).toHaveLength(1);
            }
        });

        it("collects targets from conditional transitions", () => {
            const code = `
function start() {
    say(tra(100));
    if (Global("x", "GLOBAL", 1)) {
        reply(tra(101)).goTo(branch1);
    }
    reply(tra(102)).goTo(branch2);
}
function branch1() {
    say(tra(200));
    exit();
}
function branch2() {
    say(tra(300));
    exit();
}
begin("DLG", [start]);
`;
            const result = transpile(code);
            expect(result).toContain("IF ~~ start");
            expect(result).toContain("IF ~~ branch1");
            expect(result).toContain("IF ~~ branch2");
        });
    });

    // =========================================================================
    // Orphan state warnings (Phase 9)
    // =========================================================================

    describe("Orphan state warnings", () => {
        it("warns on orphan state functions", () => {
            const code = `
function start() {
    say(tra(100));
    exit();
}
function orphan() {
    say(tra(200));
    exit();
}
begin("DLG", [start]);
`;
            const ir = parseIR(code);
            expect(ir.warnings).toBeDefined();
            expect(ir.warnings!.length).toBeGreaterThan(0);
            expect(ir.warnings![0]!.message).toContain("orphan");
        });

        it("does not warn when all states are collected", () => {
            const code = `
function start() {
    say(tra(100));
    reply(tra(101)).goTo(other);
}
function other() {
    say(tra(200));
    exit();
}
begin("DLG", [start, other]);
`;
            const ir = parseIR(code);
            expect(ir.warnings ?? []).toHaveLength(0);
        });

        it("does not warn for helper functions (called as callee)", () => {
            const code = `
function helper() {
    action_drink();
}
function start() {
    say(tra(100));
    helper();
    exit();
}
begin("DLG", [start]);
`;
            const ir = parseIR(code);
            expect(ir.warnings ?? []).toHaveLength(0);
        });

        it("does not warn for functions with parameters", () => {
            const code = `
function helper(x: number) {
    say(tra(x));
    exit();
}
function start() {
    say(tra(100));
    exit();
}
begin("DLG", [start]);
`;
            const ir = parseIR(code);
            expect(ir.warnings ?? []).toHaveLength(0);
        });

        it("warns on unused function with only engine calls in body", () => {
            const code = `
function state27() { learnAdditional("wm_ind4"); }
function state28() { learnAdditional("wm_chaob"); }
function state29() { learnAdditional("wm_wfire"); }
function start() {
    say(tra(100));
    reply(tra(101)).action(learnAdditional("wm_ind4")).goTo(next);
}
function next() {
    say(tra(200));
    exit();
}
begin("DLG", [start]);
`;
            const ir = parseIR(code);
            const warnings = ir.warnings ?? [];
            const orphanNames = warnings.map((w) => w.message);
            expect(orphanNames.some((m) => m.includes("state27"))).toBe(true);
            expect(orphanNames.some((m) => m.includes("state28"))).toBe(true);
            expect(orphanNames.some((m) => m.includes("state29"))).toBe(true);
        });

        it("warns on unused function even when similar functions are used in for-of", () => {
            const code = `
const learnSpells = [state0, state1, state2];
function state0() { learnAdditional("wm_a"); }
function state1() { learnAdditional("wm_b"); }
function state2() { learnAdditional("wm_c"); }
function state29() { learnAdditional("wm_wfire"); }
function start() {
    say(tra(100));
    for (const s of learnSpells) {
        reply(tra(101)).goTo(s);
    }
}
begin("DLG", [start]);
`;
            const ir = parseIR(code);
            const warnings = ir.warnings ?? [];
            expect(warnings.some((w) => w.message.includes("state29"))).toBe(true);
        });

        it("does not warn for transitively collected states", () => {
            const code = `
function start() {
    say(tra(100));
    reply(tra(101)).goTo(target);
}
function target() {
    say(tra(200));
    exit();
}
begin("DLG", [start]);
`;
            const ir = parseIR(code);
            expect(ir.warnings ?? []).toHaveLength(0);
        });
    });

    // =========================================================================
    // Original-source orphan detection (tree-shaking resilience)
    // =========================================================================

    describe("detectOrphansFromOriginal (tree-shaking scenarios)", () => {
        it("detects orphan in original source even when missing from IR", () => {
            // Simulates esbuild tree-shaking: state29 not in IR constructs
            const originalCode = `
function state28() { learnAdditional("wm_chaob"); }
function state29() { learnAdditional("wm_wfire"); }
function start() {
    say(tra(100));
    exit();
}
begin("DLG", [start, state28]);
`;
            // Parse IR from code WITHOUT state29 (as if tree-shaken)
            const irCode = `
function state28() { learnAdditional("wm_chaob"); }
function start() {
    say(tra(100));
    exit();
}
begin("DLG", [start, state28]);
`;
            const ir = parseIR(irCode);
            const warnings = detectOrphansFromOriginal(originalCode, ir);
            expect(warnings.some((w) => w.message.includes("state29"))).toBe(true);
            // state28 is in IR, should not be warned
            expect(warnings.some((w) => w.message.includes("state28"))).toBe(false);
        });

        it("excludes helper functions called as callees", () => {
            const originalCode = `
function learnSpell(level: number) { }
function state29() { learnSpell(5); }
function start() { say(tra(100)); exit(); }
begin("DLG", [start]);
`;
            const ir = parseIR(`
function start() { say(tra(100)); exit(); }
begin("DLG", [start]);
`);
            const warnings = detectOrphansFromOriginal(originalCode, ir);
            // learnSpell has params -> not warned
            expect(warnings.some((w) => w.message.includes("learnSpell"))).toBe(false);
            // state29 has no params, not collected -> warned
            expect(warnings.some((w) => w.message.includes("state29"))).toBe(true);
        });

        it("excludes functions with parameters", () => {
            const originalCode = `
function helper(x: number) { say(tra(x)); exit(); }
function start() { say(tra(100)); exit(); }
begin("DLG", [start]);
`;
            const ir = parseIR(`
function start() { say(tra(100)); exit(); }
begin("DLG", [start]);
`);
            const warnings = detectOrphansFromOriginal(originalCode, ir);
            expect(warnings).toHaveLength(0);
        });

        it("mergeWarnings deduplicates by message", () => {
            const parserWarnings = [
                {
                    message:
                        'Function "orphan" looks like an orphan state (not collected by any begin/append and not called as a helper)',
                    line: 5,
                    columnStart: 9,
                    columnEnd: 15,
                },
            ];
            const orphanWarnings = [
                {
                    message:
                        'Function "orphan" looks like an orphan state (not collected by any begin/append and not called as a helper)',
                    line: 3,
                    columnStart: 9,
                    columnEnd: 15,
                },
            ];
            const merged = mergeWarnings(parserWarnings, orphanWarnings);
            // Only one warning, from orphanWarnings (original source, preferred)
            expect(merged).toHaveLength(1);
            expect(merged[0]!.line).toBe(3);
        });
    });
});
