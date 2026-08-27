import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/lsp-connection", () => ({
    getConnection: () => ({ console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } }),
    getDocuments: () => ({ get: vi.fn() }),
    initLspConnection: vi.fn(),
}));

import { initParser, parseWithCache } from "../../shared/parsers/weidu-baf";
import { findStrRefSites } from "../src/ie-resources/strref-sites";

/**
 * Stands in for the generated map, whose own fidelity to the shipped engine data is covered where it is
 * produced (scripts/utils/test/generate-strref-params.test.ts). These cases are about walking the tree.
 */
const STRREF_PARAMS: Record<string, number[]> = {
    DisplayString: [1],
    SetName: [0],
    SetPlayerSound: [1],
    ActionOverride: [],
};
const paramsOf = (name: string) => STRREF_PARAMS[name];

function sites(source: string) {
    const tree = parseWithCache(source);
    if (!tree) throw new Error("BAF parser did not return a tree");
    return findStrRefSites(tree.rootNode, paramsOf);
}

beforeAll(async () => {
    await initParser();
});

describe("findStrRefSites", () => {
    it("finds the strref argument of an action and covers just the number", () => {
        const found = sites("IF\n  True()\nTHEN\n  RESPONSE #100\n    DisplayString(Myself,46150)\nEND\n");
        expect(found).toHaveLength(1);
        expect(found[0]?.strref).toBe(46150);
        const range = found[0]!.range;
        expect(range.start.line).toBe(4);
        expect(range.end.character - range.start.character).toBe("46150".length);
    });

    it("ignores a number in a slot the signature does not call a strref", () => {
        expect(sites('IF\n True()\nTHEN\n RESPONSE #100\n  SetGlobal("x","GLOBAL",75)\nEND\n')).toEqual([]);
    });

    it("leaves a tra reference alone - the translation layer resolves those, not the string table", () => {
        expect(sites("IF\n True()\nTHEN\n RESPONSE #100\n  DisplayString(Myself,@100)\nEND\n")).toEqual([]);
    });

    it("finds strrefs inside a nested call", () => {
        const found = sites(
            "IF\n True()\nTHEN\n RESPONSE #100\n  ActionOverride(Player1,DisplayString(Myself,123))\nEND\n",
        );
        expect(found.map((site) => site.strref)).toEqual([123]);
    });

    it("finds every strref in a file, in source order", () => {
        const found = sites(
            "IF\n True()\nTHEN\n RESPONSE #100\n  SetName(11)\n  DisplayString(Myself,22)\n  SetPlayerSound(Myself,33,0)\nEND\n",
        );
        expect(found.map((site) => site.strref)).toEqual([11, 22, 33]);
    });

    it("skips an action the data has no signature for", () => {
        expect(sites("IF\n True()\nTHEN\n RESPONSE #100\n  NotARealAction(46150)\nEND\n")).toEqual([]);
    });

    it("skips a strref slot holding something that is not a number", () => {
        expect(sites('IF\n True()\nTHEN\n RESPONSE #100\n  DisplayString(Myself,"text")\nEND\n')).toEqual([]);
    });
});
