/**
 * Tests for layoutFlow: the elkjs layered layout that assigns node positions for the
 * graph render. Node has no `Worker`, so layout.ts falls back to elkjs's inline engine here and these
 * run in-process; the webview builds a real worker instead, which only the render harness
 * (render-layout-thread.mts) can observe. Asserts the two contracts that matter for the render: every node
 * gets a position, and start states (no inbound edge) share the leftmost column.
 */

import { describe, expect, test } from "vitest";
import { layoutFlow } from "../src/dialog-editor/webview/layout";
import type { FlowGraph } from "../src/dialog-editor/webview/model-to-flow";

function card(id: string): FlowGraph["nodes"][number] {
    return { id, type: "card", position: { x: 0, y: 0 }, width: 200, height: 80, data: {} };
}
function edge(id: string, source: string, target: string): FlowGraph["edges"][number] {
    return { id, source, target, sourceHandle: id, kind: "forward", category: "player", dashed: false };
}

describe("layoutFlow", () => {
    test("assigns a position to every node", async () => {
        const graph: FlowGraph = {
            nodes: [card("a"), card("b"), card("c")],
            edges: [edge("a#0", "a", "b"), edge("b#0", "b", "c")],
        };
        await layoutFlow(graph);
        // A laid-out chain spreads out: not every node can remain at the origin.
        const distinctX = new Set(graph.nodes.map((n) => n.position.x));
        expect(distinctX.size).toBeGreaterThan(1);
        for (const n of graph.nodes) {
            expect(Number.isFinite(n.position.x)).toBe(true);
            expect(Number.isFinite(n.position.y)).toBe(true);
        }
    });

    test("RIGHT layout places successors to the right of their source", async () => {
        const graph: FlowGraph = {
            nodes: [card("a"), card("b"), card("c")],
            edges: [edge("a#0", "a", "b"), edge("b#0", "b", "c")],
        };
        await layoutFlow(graph);
        const x = (id: string) => graph.nodes.find((n) => n.id === id)!.position.x;
        expect(x("a")).toBeLessThan(x("b"));
        expect(x("b")).toBeLessThan(x("c"));
    });

    test("every start state (no inbound edge) lands in the same leftmost column", async () => {
        // Two independent threads: a->b and c->d. Both starts (a, c) are pinned to layer 0,
        // so they share the minimum x; the targets sit to their right.
        const graph: FlowGraph = {
            nodes: [card("a"), card("b"), card("c"), card("d")],
            edges: [edge("a#0", "a", "b"), edge("c#0", "c", "d")],
        };
        await layoutFlow(graph);
        const x = (id: string) => graph.nodes.find((n) => n.id === id)!.position.x;
        const minX = Math.min(...graph.nodes.map((n) => n.position.x));
        expect(x("a")).toBe(minX);
        expect(x("c")).toBe(minX);
        expect(x("b")).toBeGreaterThan(minX);
        expect(x("d")).toBeGreaterThan(minX);
    });

    test("assigns a finite position to a single node with no edges", async () => {
        const graph: FlowGraph = { nodes: [card("solo")], edges: [] };
        await layoutFlow(graph);
        expect(Number.isFinite(graph.nodes[0]!.position.x)).toBe(true);
        expect(Number.isFinite(graph.nodes[0]!.position.y)).toBe(true);
    });

    test("lays out a cycle (back edge) without hanging, every node finite and distinct", async () => {
        // a -> b -> a: a back edge. elk's layered algorithm breaks cycles internally; the
        // contract we depend on is only that it terminates and positions every node finitely.
        const graph: FlowGraph = {
            nodes: [card("a"), card("b")],
            edges: [edge("a#0", "a", "b"), edge("b#0", "b", "a")],
        };
        await layoutFlow(graph);
        for (const n of graph.nodes) {
            expect(Number.isFinite(n.position.x)).toBe(true);
            expect(Number.isFinite(n.position.y)).toBe(true);
        }
        const x = (id: string) => graph.nodes.find((n) => n.id === id)!.position.x;
        expect(x("a")).not.toBe(x("b"));
    });
});
