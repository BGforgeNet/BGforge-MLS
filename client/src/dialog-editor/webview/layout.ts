/**
 * Assign positions to flow nodes with elkjs (layered algorithm, left-to-right).
 * A multi-root forest shares one layering (components stack vertically) so every
 * starting state lands in the same aligned first column - see layoutFlow.
 */

// elk.bundled.js ships its web-worker inline; safe in a webview/headless context.
import ELK from "elkjs/lib/elk.bundled.js";
import type { FlowGraph } from "./model-to-flow";

const elk = new ELK();

export async function layoutFlow(graph: FlowGraph, direction: "RIGHT" | "DOWN" = "RIGHT"): Promise<void> {
    // A starting state is a card no transition points at (no inbound edge) - the entry
    // point of a conversation thread. Pin every one to elk's first layer so they share a
    // single aligned left column. Component separation packs each component's layering
    // independently (their layer-0 nodes would land at different x); keep it off so the
    // whole forest shares one layering and all FIRST nodes align at the same x.
    const targeted = new Set(graph.edges.map((e) => e.target));
    const isStart = (id: string, type: string): boolean => type === "card" && !targeted.has(id);

    // Per-source handle ids in choice order (top-to-bottom down the card's right edge).
    // Modeling each choice handle as a fixed-order elk port lets crossing-minimization see
    // the real per-reply source positions; without ports elk treats all of a card's edges
    // as leaving one point, finds zero crossings for any target order, picks arbitrarily,
    // and the fixed render handles then cross. graph.edges is already in choice order per
    // source (model-to-flow pushes a state's choice edges consecutively).
    const portsBySource = new Map<string, string[]>();
    for (const e of graph.edges) {
        if (!e.sourceHandle) continue;
        const arr = portsBySource.get(e.source);
        if (arr) arr.push(e.sourceHandle);
        else portsBySource.set(e.source, [e.sourceHandle]);
    }

    interface ElkChild {
        id: string;
        width: number;
        height: number;
        layoutOptions?: Record<string, string>;
        ports?: Array<{ id: string; layoutOptions: Record<string, string> }>;
    }

    const elkGraph = {
        id: "root",
        layoutOptions: {
            "elk.algorithm": "layered",
            "elk.direction": direction,
            "elk.spacing.nodeNode": "40",
            "elk.layered.spacing.nodeNodeBetweenLayers": "90",
            "elk.spacing.componentComponent": "60",
            // No wrapping: every construct keeps its full layer depth as one unbroken
            // left-to-right line, so a path reads straight across instead of folding into
            // stacked rows. The diagram can grow very wide - pan/scroll, not fit-to-screen.
            "elk.separateConnectedComponents": "false",
            // Use input order (edges are in reply order) as the secondary objective after
            // crossing count, so a card's targets follow its reply order where the primary
            // crossing-minimization is otherwise indifferent - further cutting crossings.
            "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        },
        children: graph.nodes.map((n) => {
            const child: ElkChild = { id: n.id, width: n.width, height: n.height };
            const layoutOptions: Record<string, string> = {};
            if (isStart(n.id, n.type)) layoutOptions["elk.layered.layering.layerConstraint"] = "FIRST";
            const handles = portsBySource.get(n.id);
            if (handles && handles.length > 0) {
                layoutOptions["elk.portConstraints"] = "FIXED_ORDER";
                // EAST side; elk's clockwise port index increases top-to-bottom on the
                // right edge, so the choice-order index maps straight to render order.
                child.ports = handles.map((id, i) => ({
                    id,
                    layoutOptions: { "elk.port.side": "EAST", "elk.port.index": String(i) },
                }));
            }
            if (Object.keys(layoutOptions).length > 0) child.layoutOptions = layoutOptions;
            return child;
        }),
        // Source an edge from its choice port so elk orders the target column to match.
        edges: graph.edges.map((e) => ({ id: e.id, sources: [e.sourceHandle ?? e.source], targets: [e.target] })),
    };

    const res = await elk.layout(elkGraph);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const c of res.children ?? []) {
        const node = byId.get(c.id);
        if (node && typeof c.x === "number" && typeof c.y === "number") {
            node.position = { x: c.x, y: c.y };
        }
    }
}
