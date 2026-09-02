/**
 * Assign positions to flow nodes with elkjs (layered algorithm, left-to-right).
 * A multi-root forest shares one layering (components stack vertically) so every
 * starting state lands in the same aligned first column - see layoutFlow.
 */

import ELK from "elkjs/lib/elk.bundled.js";
import elkWorkerSource from "elk-worker-source";
import type { FlowGraph } from "./model-to-flow";

/**
 * Lay out in a real Worker where the platform has one.
 *
 * Constructed with no options, elkjs falls back to an in-process FAKE worker and runs the whole layout on
 * the calling thread - a few hundred milliseconds for a companion-sized dialog, during which the webview
 * cannot paint or accept input. The worker script is embedded in the bundle (see
 * scripts/esbuild-elk-worker.mjs) and handed over as a blob: URL, because a webview's resource URLs are a
 * different origin and a Worker must be same-origin; `worker-src blob:` in the panel's CSP admits it.
 *
 * Node (the unit tests) has no `Worker` global, so there the fallback stands and the layout runs inline -
 * correct, just synchronous, which is what those tests assert against. The browser path is covered by the
 * render harness, which is the only tier that can observe the difference.
 */
function layoutEngine(): InstanceType<typeof ELK> {
    if (typeof Worker === "undefined") return new ELK();
    return new ELK({
        workerFactory: () => new Worker(URL.createObjectURL(new Blob([elkWorkerSource], { type: "text/javascript" }))),
    });
}

const elk = layoutEngine();

/**
 * Edge count at which `considerModelOrder` stops paying for itself.
 *
 * Below it the option costs nothing measurable - a few hundred edges lay out in a fraction of a second
 * whatever it is set to. At corpus-scale edge counts it dominates, costing an order of magnitude more
 * time than the whole rest of the layout combined.
 */
export const MODEL_ORDER_EDGE_LIMIT = 400;

/**
 * Whether to ask elk to preserve model order, which it honours only where doing so adds no edge crossing.
 *
 * That condition is why the option is worth dropping on a dense graph rather than tuning: as edges
 * multiply, nearly every order it would preserve now costs a crossing, so it declines the preservation and
 * still pays the full extra search. Measured across the widest real dialogs, disabling it above this limit
 * took roughly three quarters off the graph's first draw while moving reply-order fidelity by a couple of
 * points in each direction - better on one file, worse on the other.
 */
export function modelOrderStrategy(edgeCount: number): "NODES_AND_EDGES" | "NONE" {
    return edgeCount < MODEL_ORDER_EDGE_LIMIT ? "NODES_AND_EDGES" : "NONE";
}

export async function layoutFlow(graph: FlowGraph): Promise<void> {
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
            "elk.direction": "RIGHT",
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
            // Dropped on dense graphs; see modelOrderStrategy.
            "elk.layered.considerModelOrder.strategy": modelOrderStrategy(graph.edges.length),
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
