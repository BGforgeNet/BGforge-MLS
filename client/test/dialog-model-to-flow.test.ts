/**
 * Tests for modelToFlow: the pure DialogModel -> Svelte Flow (nodes + edges) transform
 * that feeds the graph render path. Driven by the hand-built SAMPLE (targeted cases:
 * cycle, conditional, exit, external) and REAL_MODEL (frozen output of the real
 * modelFromD producer) for a structural end-to-end sanity check.
 */

import { describe, expect, test } from "vitest";
import { modelToFlow, stateNodeSize } from "../src/dialog-editor/webview/model-to-flow";
import { stateBadges, type DialogModel, type DialogState } from "../../shared/dialog-model";
import { SAMPLE } from "../src/dialog-editor/test/harness/sample-model";
import { REAL_MODEL } from "../src/dialog-editor/test/harness/real-model";

const allStates = (m: DialogModel) => m.roots.flatMap((r) => r.states);

describe("modelToFlow - cards and edges", () => {
    test("emits one card node per state, keyed by state id", () => {
        const { nodes } = modelToFlow(SAMPLE);
        const cards = nodes.filter((n) => n.type === "card");
        expect(cards.map((n) => n.id).sort()).toEqual(["hello", "more"]);
        for (const c of cards) expect(c.data.state).toBeDefined();
    });

    test("emits one edge per choice, sourced from the choice's own handle", () => {
        const { edges } = modelToFlow(SAMPLE);
        const hello0 = edges.find((e) => e.id === "hello#0");
        expect(hello0).toMatchObject({ source: "hello", target: "more", sourceHandle: "hello#0", kind: "forward" });
    });

    test("a choice with reply text is a 'player' edge; a bare continue is 'continue'", () => {
        const model: DialogModel = {
            format: "weidu-d",
            editable: true,
            roots: [
                {
                    id: "d",
                    label: "d",
                    kind: "dialog",
                    states: [
                        {
                            id: "s",
                            speaker: "X",
                            text: "hi",
                            choices: [
                                { id: "s#0", text: "pick me", target: { kind: "state", stateId: "s" } },
                                { id: "s#1", target: { kind: "state", stateId: "s" } },
                            ],
                        },
                    ],
                },
            ],
        };
        const { edges } = modelToFlow(model);
        expect(edges.find((e) => e.id === "s#0")?.category).toBe("player");
        expect(edges.find((e) => e.id === "s#1")?.category).toBe("continue");
    });
});

describe("modelToFlow - synthetic terminals and stubs", () => {
    test("an exit choice points at a single shared 'exit' node", () => {
        const { nodes, edges } = modelToFlow(SAMPLE);
        const exitNodes = nodes.filter((n) => n.type === "exit");
        expect(exitNodes).toHaveLength(1);
        expect(exitNodes[0]?.id).toBe("exit");
        const exitEdge = edges.find((e) => e.id === "hello#1");
        expect(exitEdge).toMatchObject({ target: "exit", category: "exit" });
    });

    test("a conditional choice is dashed", () => {
        // hello#1 carries condition "Reputation<5".
        const { edges } = modelToFlow(SAMPLE);
        expect(edges.find((e) => e.id === "hello#1")?.dashed).toBe(true);
    });

    test("an external target becomes a deduplicated 'ext:' stub and a dashed external edge", () => {
        const { nodes, edges } = modelToFlow(SAMPLE);
        const stub = nodes.find((n) => n.type === "external");
        expect(stub?.id).toBe("ext:%AJ_POST%:0");
        const extEdge = edges.find((e) => e.id === "more#1");
        expect(extEdge).toMatchObject({ target: "ext:%AJ_POST%:0", category: "external", dashed: true });
    });

    test("a goto to a state absent from the model is kept as an external stub, not a dangling edge", () => {
        const model: DialogModel = {
            format: "weidu-d",
            editable: true,
            roots: [
                {
                    id: "d",
                    label: "d",
                    kind: "dialog",
                    states: [
                        {
                            id: "a",
                            speaker: "X",
                            text: "t",
                            choices: [{ id: "a#0", target: { kind: "state", stateId: "ghost" } }],
                        },
                    ],
                },
            ],
        };
        const { nodes, edges } = modelToFlow(model);
        expect(edges.find((e) => e.id === "a#0")?.target).toBe("ext:ghost");
        expect(nodes.find((n) => n.id === "ext:ghost")?.type).toBe("external");
    });
});

describe("modelToFlow - cycles", () => {
    test("marks a returning edge in a two-state cycle as a back edge", () => {
        // SAMPLE: hello -> more -> hello is a cycle; exactly one of the two is the back edge.
        const { edges } = modelToFlow(SAMPLE);
        const cycleEdges = edges.filter((e) => e.id === "hello#0" || e.id === "more#0");
        const backs = cycleEdges.filter((e) => e.kind === "back");
        expect(backs).toHaveLength(1);
        expect(backs[0]?.dashed).toBe(true);
    });
});

describe("modelToFlow - real producer output (no dangling edges)", () => {
    test("every state yields a card and every edge resolves to a real node", () => {
        const { nodes, edges } = modelToFlow(REAL_MODEL);
        const cardIds = new Set(nodes.filter((n) => n.type === "card").map((n) => n.id));
        for (const s of allStates(REAL_MODEL)) expect(cardIds.has(s.id)).toBe(true);
        const nodeIds = new Set(nodes.map((n) => n.id));
        for (const e of edges) expect(nodeIds.has(e.target)).toBe(true);
    });
});

describe("modelToFlow - spotlight flag", () => {
    test("tags each card with whether it is flagged (carries a badge)", () => {
        const model: DialogModel = {
            format: "weidu-d",
            editable: true,
            roots: [
                {
                    id: "d",
                    label: "d",
                    kind: "dialog",
                    states: [
                        {
                            id: "plain",
                            speaker: "X",
                            text: "hi",
                            choices: [{ id: "plain#0", text: "ok", target: { kind: "exit" } }],
                        },
                        { id: "flagged", speaker: "X", text: "hi", trigger: "x", choices: [] },
                    ],
                },
            ],
        };
        const { nodes } = modelToFlow(model);
        expect(nodes.find((n) => n.id === "plain")?.data.flagged).toBe(false);
        expect(nodes.find((n) => n.id === "flagged")?.data.flagged).toBe(true);
    });

    test("carries an SSL side-effect node's signal to the card the renderer badges", () => {
        // The card renderer (Node.svelte) reads stateBadges(card.data.state); a side-effect
        // node must reach the card with enough state for that to include "side-effect", and
        // be flagged for the spotlight. Guards against data.state being narrowed to a subset.
        const model: DialogModel = {
            format: "fallout-ssl",
            editable: false,
            roots: [
                {
                    id: "d",
                    label: "d",
                    kind: "dialog",
                    states: [{ id: "Node001", text: "100", choices: [], sideEffects: ["set_global_var"] }],
                },
            ],
        };
        const card = modelToFlow(model).nodes.find((n) => n.id === "Node001")!;
        expect(card.data.flagged).toBe(true);
        // FlowNode.data is a loose Record; the card branch sets data.state to the DialogState
        // (model-to-flow card node), so narrow it to call the same stateBadges Node.svelte renders.
        const cardState = card.data.state as DialogState;
        expect(stateBadges(cardState)).toContain("side-effect");
    });
});

describe("stateNodeSize", () => {
    test("grows the card height as the resolved text wraps to more lines", () => {
        const state = { id: "s", speaker: "X", text: "t", choices: [] };
        const oneLine = stateNodeSize(state, 10);
        const manyLines = stateNodeSize(state, 240);
        expect(manyLines.height).toBeGreaterThan(oneLine.height);
        expect(manyLines.width).toBe(oneLine.width); // width is fixed; only height tracks text
    });
});
