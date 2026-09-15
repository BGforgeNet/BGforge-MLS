/**
 * The resource tree's identity and parent decisions - what `TreeView.reveal` rests on.
 *
 * The provider itself is framework-bound and coverage-excluded; these are the parts that decide whether a
 * reveal can find its row, so they are tested here rather than through a mocked tree view.
 */
import { describe, expect, it } from "vitest";
import { type Node, nodeId, parentTypeOf } from "../src/ie-resources/tree-nodes";

const BAM = 0x03e8;
const ITM = 0x03ed;

const game: Node = { kind: "game", label: "BG2:ToB", dir: "/games/bg2" };
const bamGroup: Node = { kind: "type", type: BAM, ext: "bam", count: 12 };
const icon: Node = { kind: "resource", resref: "ISW1H01", type: BAM, ext: "bam", openable: true };

describe("nodeId", () => {
    it("is stable across two constructions of the same row", () => {
        expect(nodeId({ ...icon })).toBe(nodeId({ ...icon }));
    });

    /**
     * The reason ids are explicit at all: VS Code derives one from the LABEL otherwise, so a row whose label
     * changes silently loses its selection and expansion state. A count that moves must not move the id.
     */
    it("ignores the parts of a row that are display only", () => {
        expect(nodeId({ ...bamGroup, count: 999 })).toBe(nodeId(bamGroup));
        expect(nodeId({ ...icon, openable: false })).toBe(nodeId(icon));
    });

    it("separates rows of different kinds, types and resrefs", () => {
        const ids = [
            nodeId(game),
            nodeId(bamGroup),
            nodeId(icon),
            nodeId({ ...icon, resref: "ISW1H02" }),
            nodeId({ ...icon, type: ITM, ext: "itm" }),
        ];
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe("parentTypeOf", () => {
    it("puts a resource under its type group", () => {
        expect(parentTypeOf(icon)).toBe(BAM);
    });

    // The walk `reveal` makes has to terminate: a group and the game row are already at the root.
    it("leaves type and game rows at the root", () => {
        expect(parentTypeOf(bamGroup)).toBeUndefined();
        expect(parentTypeOf(game)).toBeUndefined();
    });
});
