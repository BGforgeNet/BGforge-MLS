import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import "../src"; // side-effect: register parsers and adapters
import { creParser } from "../src/cre";
import { buildCreMemorizeBytes } from "../src/cre/entity-ops";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
// A real BG2 mage (Edwin) with memorized spells at Wizard L1-3 and empty (capacity-only) rows for other
// levels - exercises both the populated-range and empty-range append paths.
const FIXTURE = path.join(REPO_ROOT, "external/infinity-engine/BGT-WeiDU/bgt/modify/cre/edwin6.cre");

// Raw-tree helpers (the parse result's display tree: groups carry `.fields`, leaf fields carry `.value`/`.rawValue`).
type Node = { name: string; fields?: Node[]; value?: unknown; rawValue?: unknown };
const isGroup = (n: Node): boolean => Array.isArray(n.fields);
const section = (root: Node, name: string): Node => root.fields!.find((f) => f.name === name && isGroup(f))!;
const entries = (g: Node): Node[] => g.fields!.filter((n) => isGroup(n));
const numOf = (g: Node, name: string): number => {
    const f = g.fields!.find((x) => x.name === name);
    return Number(f?.rawValue ?? f?.value);
};
const count = (owner: Node): number => numOf(owner, "Memorized Spell Count");
const start = (owner: Node): number => numOf(owner, "First Memorized Spell Index");

type Parsed = { root: Node; errors?: string[] };
const parse = (bytes: Uint8Array) => {
    const pr = creParser.parse(bytes);
    const r = pr as unknown as Parsed;
    expect(r.errors ?? []).toEqual([]);
    return { pr, root: r.root };
};

describe("buildCreMemorizeBytes (append a memorized spell to a level's range)", () => {
    const present = fs.existsSync(FIXTURE);
    const maybe = present ? test : test.skip;

    maybe("appends to a populated range: that row's count +1, total +1, later rows shift +1", () => {
        const bytes = new Uint8Array(fs.readFileSync(FIXTURE));
        const { pr, root } = parse(bytes);
        const owners = entries(section(root, "Spell Memorization Info"));
        const total = entries(section(root, "Memorized Spells")).length;
        const idx = owners.findIndex((o) => count(o) > 0);
        expect(idx).toBeGreaterThanOrEqual(0);
        const beforeCount = count(owners[idx]!);
        const laterStarts = owners.slice(idx + 1).map((o) => start(o));

        const out = buildCreMemorizeBytes(pr, idx);
        expect(out).toBeDefined();
        const r2 = parse(out!);
        const owners2 = entries(section(r2.root, "Spell Memorization Info"));
        expect(count(owners2[idx]!)).toBe(beforeCount + 1);
        expect(entries(section(r2.root, "Memorized Spells")).length).toBe(total + 1);
        // Every row after the edited one shifts its start by exactly +1 (the inserted slice pushed them down).
        owners2.slice(idx + 1).forEach((o, i) => expect(start(o)).toBe(laterStarts[i]! + 1));
    });

    maybe("appends to an EMPTY range (capacity, no entries): count 0 -> 1", () => {
        const bytes = new Uint8Array(fs.readFileSync(FIXTURE));
        const { pr, root } = parse(bytes);
        const owners = entries(section(root, "Spell Memorization Info"));
        const total = entries(section(root, "Memorized Spells")).length;
        const idx = owners.findIndex((o) => count(o) === 0);
        expect(idx).toBeGreaterThanOrEqual(0); // a real mage always has some empty memorization rows

        const out = buildCreMemorizeBytes(pr, idx);
        expect(out).toBeDefined();
        const r2 = parse(out!);
        const owners2 = entries(section(r2.root, "Spell Memorization Info"));
        expect(count(owners2[idx]!)).toBe(1);
        expect(entries(section(r2.root, "Memorized Spells")).length).toBe(total + 1);
    });

    maybe("out-of-range owner index returns undefined (no-op)", () => {
        const bytes = new Uint8Array(fs.readFileSync(FIXTURE));
        const { pr, root } = parse(bytes);
        const owners = entries(section(root, "Spell Memorization Info"));
        expect(buildCreMemorizeBytes(pr, owners.length)).toBeUndefined();
        expect(buildCreMemorizeBytes(pr, -1)).toBeUndefined();
    });
});
