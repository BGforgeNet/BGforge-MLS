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

describe("modelToFlow - duplicate state ids (shared CHAIN label)", () => {
    test("collapses states sharing an id to one card so svelte-flow node and edge keys stay unique", () => {
        // A WeiDU D root can carry the same state label twice - two CHAIN blocks whose terminal state is
        // `VISK1` (x#viconia.d, lines 372 & 383). Emitting a card per raw state hands svelte-flow two nodes
        // with id "VISK1"; its internal keyed {#each} then throws each_key_duplicate and the graph render
        // crashes. One card per DISTINCT id keeps node (and edge) keys unique - matching the tree, which
        // already merges these states.
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
                            id: "Talk",
                            text: "hi",
                            choices: [{ id: "Talk#0", text: "go", target: { kind: "state", stateId: "VISK1" } }],
                        },
                        { id: "VISK1", text: "one", choices: [{ id: "VISK1#0", target: { kind: "exit" } }] },
                        { id: "VISK1", text: "two", choices: [{ id: "VISK1#0", target: { kind: "exit" } }] },
                    ],
                },
            ],
        };
        const { nodes, edges } = modelToFlow(model);
        const nodeIds = nodes.map((n) => n.id);
        expect(new Set(nodeIds).size).toBe(nodeIds.length); // unique node keys: no each_key_duplicate
        expect(nodeIds.filter((id) => id === "VISK1")).toHaveLength(1);
        const edgeIds = edges.map((e) => e.id);
        expect(new Set(edgeIds).size).toBe(edgeIds.length); // and unique edge keys
        // The edge into VISK1 still resolves to the (single) VISK1 card - no dangling.
        expect(edges.find((e) => e.id === "Talk#0")?.target).toBe("VISK1");
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

    test("carries structural editability onto each card (drives handle connectability)", () => {
        // Node.svelte gates drag-to-retarget on data.structuralEditable; an editable (D) model
        // marks its cards editable, while a view-only SSL model with no faithful node marks them
        // non-editable so structure can't be dragged. Guards the source of that wiring (the SSL
        // faithful/non-faithful split is covered by the dedicated test below).
        const ssl: DialogModel = {
            format: "fallout-ssl",
            editable: false,
            roots: [{ id: "d", label: "d", kind: "dialog", states: [{ id: "N", text: "@1", choices: [] }] }],
        };
        expect(modelToFlow(ssl).nodes.find((n) => n.id === "N")?.data.structuralEditable).toBe(false);
        expect(modelToFlow(SAMPLE).nodes.find((n) => n.type === "card")?.data.structuralEditable).toBe(true);
    });

    test("a faithful SSL node is structurally editable; a non-faithful one is not", () => {
        // structuralEditable promotes the model-level `editable` to per-node: a view-only SSL
        // model still lets faithful nodes be edited structurally, while complex ones stay locked.
        const ssl = (faithful: boolean): DialogModel => ({
            format: "fallout-ssl",
            editable: false,
            roots: [{ id: "d", label: "d", kind: "dialog", states: [{ id: "N", text: "@1", choices: [], faithful }] }],
        });
        expect(modelToFlow(ssl(true)).nodes.find((n) => n.id === "N")?.data.structuralEditable).toBe(true);
        expect(modelToFlow(ssl(false)).nodes.find((n) => n.id === "N")?.data.structuralEditable).toBe(false);
    });
});

describe("modelToFlow - shared-text coupling", () => {
    test("flags every state that shares a @N ref (line or option) with another state", () => {
        const model: DialogModel = {
            format: "fallout-ssl",
            editable: false,
            roots: [
                {
                    id: "d",
                    label: "d",
                    kind: "dialog",
                    states: [
                        { id: "A", text: "@100", choices: [] },
                        { id: "B", text: "@100", choices: [] }, // shares its line @100 with A
                        { id: "C", text: "@200", choices: [{ id: "C#0", text: "@300", target: { kind: "exit" } }] },
                        { id: "D", text: "@400", choices: [{ id: "D#0", text: "@300", target: { kind: "exit" } }] }, // shares option @300 with C
                        { id: "E", text: "@500", choices: [] }, // fully unique
                    ],
                },
            ],
        };
        const byId = Object.fromEntries(
            modelToFlow(model)
                .nodes.filter((n) => n.type === "card")
                .map((n) => [n.id, n.data.sharedText]),
        );
        expect(byId).toEqual({ A: true, B: true, C: true, D: true, E: false });
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
