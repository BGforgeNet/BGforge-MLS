import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTSSLSource } from "../src/tssl/dialog-source";

const sample = (name: string): string =>
    readFileSync(fileURLToPath(new URL(`tssl/samples/${name}`, import.meta.url)), "utf8");

describe("parseTSSLSource - flat dialog", () => {
    const flat = sample("flat.tssl");

    it("finds both nodes, each with a procRange into the TSSL source", () => {
        const data = parseTSSLSource(flat);
        expect(data.nodes.map((n) => n.name).sort()).toEqual(["Node001", "Node002"]);
        const n1 = data.nodes.find((n) => n.name === "Node001")!;
        // procRange must slice back to the TSSL source (not generated SSL) - the whole point of source parsing.
        expect(flat.slice(n1.procRange!.start, n1.procRange!.end)).toContain("function Node001");
    });

    it("a flat node of dialog calls is faithful, with its option target", () => {
        const n1 = parseTSSLSource(flat).nodes.find((n) => n.name === "Node001")!;
        expect(n1.faithful).toBe(true);
        expect(n1.replies.map((r) => r.msgId)).toEqual([100]);
        expect(n1.options.map((o) => o.target)).toEqual(["Node002"]);
        expect(n1.options.map((o) => o.msgId)).toEqual([101]);
    });

    it("collects the entry point from talk_p_proc", () => {
        expect(parseTSSLSource(flat).entryPoints).toContain("Node001");
    });
});

describe("parseTSSLSource - tiers", () => {
    // SSL semantics (mirrored): a single-level `if` with no `else` is faithful; nesting an `if` is structured.
    it("a single-level if (no else) is still faithful", () => {
        const n1 = parseTSSLSource(sample("conditional.tssl")).nodes.find((n) => n.name === "Node001")!;
        expect(n1.faithful).toBe(true);
    });

    it("records the enclosing-if condition span on a conditional option (edit-ready)", () => {
        const src = sample("conditional.tssl");
        const opt = parseTSSLSource(src).nodes.find((n) => n.name === "Node001")!.options[0]!;
        expect(opt.conditional).toContain("GVAR_X");
        expect(src.slice(opt.condRange!.start, opt.condRange!.end)).toContain("GVAR_X");
        expect(opt.ifPure).toBe(true); // the then-block holds this option alone -> condition-editable
    });

    it("a nested if is structured (read-only, faithfully displayed)", () => {
        const n1 = parseTSSLSource(sample("nested.tssl")).nodes.find((n) => n.name === "Node001")!;
        expect(n1.faithful).toBe(false);
        expect(n1.structured).toBe(true);
    });
});
