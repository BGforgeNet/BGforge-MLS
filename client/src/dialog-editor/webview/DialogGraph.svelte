<script lang="ts">
    import { SvelteFlow, Background, Controls, ControlButton, MiniMap, Panel } from "@xyflow/svelte";
    import "@xyflow/svelte/dist/style.css";
    import { untrack } from "svelte";
    import Node from "./Node.svelte";
    import Inspector from "./Inspector.svelte";
    import ReconnectEdge from "./ReconnectEdge.svelte";
    import Tree from "./Tree.svelte";
    import { modelToFlow, type FlowNode, type FlowEdge } from "./model-to-flow";
    import { buildConversationTree, type ConvState } from "./conversation-tree";
    import { resolveJumpTarget } from "./jump-resolve";
    import { layoutFlow } from "./layout";
    import { modelToD } from "../../../../shared/dialog-d-serialize";
    import * as ops from "../../../../shared/dialog-edit-ops";
    import { eligibleToDelete } from "../../../../shared/dialog-ssl-edit";
    import { hasHost, postToHost } from "./host";
    import type { DialogModel, DialogState, DialogTarget } from "../../../../shared/dialog-model";

    let { model }: { model: DialogModel } = $props();

    const nodeTypes = { card: Node, external: Node, exit: Node };
    const edgeTypes = { reconnectable: ReconnectEdge };

    // Working copy the editor mutates. The `model` prop is the host's last-posted state;
    // edits stay local until a save path serializes editModel back (a later phase).
    function cloneModel(m: DialogModel): DialogModel {
        // `m` is normally a Svelte $state proxy (App.svelte holds the model in reactive
        // state and passes it as a prop). structuredClone throws DataCloneError on a proxy,
        // which previously aborted the render and left the panel stuck on "Parsing dialog...".
        // $state.snapshot unwraps the proxy to a plain deep clone first; the harness passes a
        // raw object, which snapshots fine too. The cast drops the snapshot's deep-readonly
        // type - the value is a plain mutable DialogModel that the caller re-wraps as $state.
        return $state.snapshot(m) as DialogModel;
    }
    let editModel = $state<DialogModel>(cloneModel(model));

    let nodes = $state.raw<unknown[]>([]);
    let edges = $state.raw<unknown[]>([]);
    let selected = $state<DialogState | null>(null);
    let viewport = $state({ x: 0, y: 0, zoom: 1 });
    let containerW = $state(0);
    let containerH = $state(0);
    let laidOut = $state.raw<FlowNode[]>([]);
    let showSource = $state(false);
    // Spotlight overlay (1B): dim fully-authored ("trusted") cards so the derived/uncertain
    // ones stand out. Read-only; just a CSS class flip (each card already carries `flagged`
    // from model-to-flow), so toggling needs no relayout.
    let spotlight = $state(false);

    // Two views of the same dialog: the node graph (default) and a conversation-flow
    // tree. The toggle swaps the canvas; tabs, the inspector, and the toolbar are
    // shared. The tree is built per active tab, same scoping as the graph.
    let viewMode = $state<"graph" | "tree">("graph");

    // One tab per destination dialog file (a root with states). Each tab renders only its
    // own file's states; a transition to another file shows as an external stub that jumps
    // to that file's tab (see attachJumpTargets / onNodeClick).
    let activeFile = $state<string>("");
    const tabs = $derived(editModel.roots.filter((r) => r.states.length > 0));
    const activeRoot = $derived(editModel.roots.find((r) => r.id === activeFile) ?? tabs[0] ?? null);

    // Cross-file resolution: which root owns a given state id, and which root is a given
    // dialog file. Used to turn an external stub into a jump to the owning tab.
    const stateToRoot = $derived.by(() => {
        const m = new Map<string, string>();
        for (const r of editModel.roots) for (const s of r.states) m.set(s.id, r.id);
        return m;
    });
    const fileToRoot = $derived.by(() => {
        const m = new Map<string, string>();
        for (const r of editModel.roots) if (r.states.length > 0) m.set(r.label, r.id);
        return m;
    });

    // Per-tab layout: cache each file's node positions so switching tabs (and editing on a
    // tab) preserves manual drags instead of re-running elk. `renderedFile` tracks which
    // file the live `nodes` array currently represents, so a tab switch does not merge the
    // previous tab's dragged positions into the new tab.
    const tabPos = new Map<string, Map<string, { x: number; y: number }>>();
    let renderedFile = "";

    // Target dropdown offers same-file states only - a GOTO (kind:state) is within one
    // dialog; cross-file links are EXTERN and handled separately.
    const stateIds = $derived(activeRoot?.states.map((s) => s.id) ?? []);
    // Live serialization of the edited model back to WeiDU D. Only D is serializable;
    // recomputes as edits mutate editModel (a save path will post this to the host).
    const sourceText = $derived(showSource && editModel.format === "weidu-d" ? modelToD(editModel) : "");
    let showIssues = $state(false);

    // Inline validation: a dangling GOTO (target state no longer exists) and duplicate
    // labels are the errors that break a saved .d; surface them as you edit.
    const issues = $derived.by(() => {
        const out: string[] = [];
        const seen = new Set<string>();
        const dups = new Set<string>();
        for (const r of editModel.roots) {
            for (const s of r.states) {
                if (seen.has(s.id)) dups.add(s.id);
                seen.add(s.id);
            }
        }
        for (const d of dups) out.push(`Duplicate state label: ${d}`);
        for (const r of editModel.roots) {
            for (const s of r.states) {
                for (const c of s.choices) {
                    if (c.target.kind === "state" && !seen.has(c.target.stateId)) {
                        out.push(`${s.id}: transition points to missing state "${c.target.stateId}"`);
                    }
                }
            }
        }
        return out;
    });

    /**
     * Frame the whole laid-out graph from elk's coordinates and our known node sizes.
     * Svelte Flow's own `fitView` frames an empty region (it runs before the async elk
     * layout assigns positions and does not recover), so the built-in fit button is
     * disabled (showFitView={false}) in favour of this.
     */
    function fitViewport(): void {
        const cw = containerW || window.innerWidth;
        const ch = containerH || window.innerHeight;
        if (laidOut.length === 0 || cw === 0 || ch === 0) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of laidOut) {
            minX = Math.min(minX, n.position.x);
            minY = Math.min(minY, n.position.y);
            maxX = Math.max(maxX, n.position.x + n.width);
            maxY = Math.max(maxY, n.position.y + n.height);
        }
        const gw = Math.max(maxX - minX, 1);
        const gh = Math.max(maxY - minY, 1);
        const pad = 0.12;
        const zoom = Math.min(Math.max(Math.min((cw * (1 - pad)) / gw, (ch * (1 - pad)) / gh), 0.05), 1.5);
        viewport = { x: (cw - gw * zoom) / 2 - minX * zoom, y: (ch - gh * zoom) / 2 - minY * zoom, zoom };
    }

    // Open on a specific node at a readable zoom, placed left so its rightward branches
    // stay in view - a large dialog fit to the whole graph is illegible on load.
    function focusNode(id: string, zoom = 0.85): void {
        const cw = containerW || window.innerWidth;
        const ch = containerH || window.innerHeight;
        const node = laidOut.find((n) => n.id === id);
        if (!node || cw === 0 || ch === 0) {
            fitViewport();
            return;
        }
        viewport = { x: cw * 0.12 - node.position.x * zoom, y: ch / 2 - (node.position.y + node.height / 2) * zoom, zoom };
    }
    function focusEntry(): void {
        const entryId = activeRoot?.states[0]?.id ?? laidOut[0]?.id;
        if (entryId) focusNode(entryId);
        else fitViewport();
    }

    // Resolve each external stub to the tab + state it represents, if that destination is
    // one of our dialog files, and stamp it on the node as `jumpTo` so a click can switch
    // tabs. A stub whose destination is a dialog this .d does not touch stays a dead stub.
    function attachJumpTargets(g: { nodes: FlowNode[] }): void {
        for (const n of g.nodes) {
            if (n.type !== "external") continue;
            const jump = resolveJumpTarget(String(n.data.label ?? ""), stateToRoot, fileToRoot);
            if (jump) n.data = { ...n.data, jumpTo: jump };
        }
    }

    // Conversation-flow tree for the active tab. Derived, so any edit to the model
    // (NPC line, reply, retarget, add/delete state) re-projects the tree just like
    // the graph - no manual refresh. Cross-file leaves resolve through the same
    // jump resolver the graph stubs use.
    const treeData = $derived(
        activeRoot
            ? buildConversationTree(activeRoot, editModel.messages, (label) => resolveJumpTarget(label, stateToRoot, fileToRoot))
            : { roots: [] },
    );

    // Per-state collapse for the tree, owned here so the toolbar's expand-all /
    // collapse-all can drive it. Reassigned (not mutated in place) so the Set change
    // is reactive. A state is collapsed iff its id is in the set.
    let treeCollapsed = $state<Set<string>>(new Set());
    function toggleTreeNode(id: string): void {
        const next = new Set(treeCollapsed);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        treeCollapsed = next;
    }
    // Every collapsible state in the current tree (each ConvState appears once).
    function allTreeStateIds(): string[] {
        const ids: string[] = [];
        const walk = (s: ConvState): void => {
            ids.push(s.id);
            for (const r of s.replies) if (r.target.kind === "state") walk(r.target.node);
        };
        treeData.roots.forEach(walk);
        return ids;
    }
    const expandAll = (): void => {
        treeCollapsed = new Set();
    };
    const collapseAll = (): void => {
        treeCollapsed = new Set(allTreeStateIds());
    };

    function findState(stateId: string): DialogState | null {
        for (const r of editModel.roots) {
            const s = r.states.find((x) => x.id === stateId);
            if (s) return s;
        }
        return null;
    }
    // Tree-row click: select the state for the shared Inspector.
    function selectTreeState(stateId: string): void {
        const s = findState(stateId);
        if (s) selected = s;
    }

    // Right-click context menu in the tree: structural actions without the
    // select-then-inspector round-trip. A state row offers state actions; a reply row
    // offers reply actions plus a target picker. Both reuse the same `actions` the
    // inspector calls (which operate on `selected`), so each handler selects the owner
    // state first - no parallel edit logic.
    type CtxMenu =
        | { kind: "state"; x: number; y: number; stateId: string }
        | { kind: "reply"; x: number; y: number; stateId: string; choiceId: string; index: number; count: number };
    let ctxMenu = $state<CtxMenu | null>(null);
    let ctxPickTarget = $state(false); // reply menu: on the "set target" sub-page
    const ctxOwner = $derived(ctxMenu ? findState(ctxMenu.stateId) : null);
    const ctxReply = $derived(ctxMenu?.kind === "reply" ? ctxMenu : null);

    // Clamp so the menu (or its taller target-picker page) never opens off-screen.
    const clampX = (x: number): number => Math.max(8, Math.min(x, window.innerWidth - 180));
    const clampY = (y: number): number => Math.max(8, Math.min(y, window.innerHeight - 300));
    function openContext(stateId: string, x: number, y: number): void {
        ctxPickTarget = false;
        ctxMenu = { kind: "state", x: clampX(x), y: clampY(y), stateId };
    }
    function openReplyContext(stateId: string, choiceId: string, index: number, count: number, x: number, y: number): void {
        ctxPickTarget = false;
        ctxMenu = { kind: "reply", x: clampX(x), y: clampY(y), stateId, choiceId, index, count };
    }
    const closeContext = (): void => {
        ctxMenu = null;
        ctxPickTarget = false;
    };
    function ctxAct(kind: "addReply" | "duplicate" | "delete"): void {
        const st = ctxMenu ? findState(ctxMenu.stateId) : null;
        closeContext();
        if (!st || st.derivedFrom) return;
        selected = st;
        if (kind === "addReply") actions.addReply();
        else if (kind === "duplicate") actions.duplicateState();
        else actions.deleteState();
    }
    function replyAct(kind: "remove" | "up" | "down"): void {
        if (ctxMenu?.kind !== "reply") return;
        const { stateId, choiceId } = ctxMenu;
        closeContext();
        const st = findState(stateId);
        if (!st || st.derivedFrom) return;
        selected = st;
        if (kind === "remove") actions.removeReply(choiceId);
        else actions.moveReply(choiceId, kind === "up" ? -1 : 1);
    }
    function setReplyTarget(target: DialogTarget): void {
        if (ctxMenu?.kind !== "reply") return;
        const { stateId, choiceId } = ctxMenu;
        closeContext();
        const st = findState(stateId);
        if (!st || st.derivedFrom) return;
        selected = st;
        actions.setTarget(choiceId, target);
    }
    // Tree cross-file leaf: switch to the destination tab and select the target there.
    function treeJump(file: string, stateId: string): void {
        switchTab(file, stateId);
        selectTreeState(stateId);
    }

    function edgeStyle(e: FlowEdge): string {
        const color =
            e.kind === "back"
                ? "#f59e0b"
                : e.category === "exit"
                  ? "#ef4444"
                  : e.category === "external"
                    ? "#f59e0b"
                    : e.category === "player"
                      ? "#a3e635"
                      : "#64748b";
        const dash = e.dashed || e.kind === "back" ? ";stroke-dasharray:5 4" : "";
        return `stroke:${color}${dash}`;
    }

    // frame: "entry" (open at the active tab's entry), "fit" (whole graph), "none" (keep
    // viewport - for mid-edit structural changes). focusId overrides to center a node.
    // relayout: run elk afresh (load / explicit re-tidy). Without it, existing nodes keep
    // their positions so an edit (delete/retarget/reorder) doesn't reshuffle the graph -
    // only newly-added nodes are placed (off to the right).
    //
    // Renders only the active tab's root. Each tab's positions are cached in `tabPos`, so a
    // switch restores a previously-laid-out tab without elk and without inheriting the
    // previous tab's drags (guarded by `renderedFile`).
    async function rebuild(opts: { frame?: "entry" | "fit" | "none"; focusId?: string; relayout?: boolean } = {}): Promise<void> {
        // Flush any live drags on the currently-rendered tab into its cache before we may
        // switch tabs - a drag updates `nodes` but fires no rebuild, so without this the
        // dragged positions are lost when leaving and returning to the tab.
        if (renderedFile) {
            const cur = tabPos.get(renderedFile) ?? new Map<string, { x: number; y: number }>();
            for (const n of nodes as Array<{ id: string; position?: { x: number; y: number } }>) {
                if (n.position) cur.set(n.id, n.position);
            }
            tabPos.set(renderedFile, cur);
        }

        const root = activeRoot;
        const fileId = root?.id ?? "";
        const g = modelToFlow(root ? { ...editModel, roots: [root] } : editModel);
        attachJumpTargets(g);
        const cached = tabPos.get(fileId);
        const sameTab = renderedFile === fileId;

        if (opts.relayout || !cached) {
            await layoutFlow(g);
        } else {
            // Start from this tab's cached positions; merge live drags only if `nodes` still
            // shows this same tab (otherwise it holds the previous tab's coordinates).
            const live = new Map<string, { x: number; y: number }>(cached);
            if (sameTab) {
                for (const n of nodes as Array<{ id: string; position?: { x: number; y: number } }>) {
                    if (n.position) live.set(n.id, n.position);
                }
            }
            let maxX = 0;
            let minY = Infinity;
            const fresh: FlowNode[] = [];
            for (const n of g.nodes) {
                const kept = live.get(n.id);
                if (kept) {
                    n.position = kept;
                    maxX = Math.max(maxX, kept.x + n.width);
                    minY = Math.min(minY, kept.y);
                } else {
                    fresh.push(n);
                }
            }
            if (!Number.isFinite(minY)) minY = 0;
            fresh.forEach((n, i) => (n.position = { x: maxX + 80, y: minY + i * 90 }));
        }
        // Persist this tab's final positions for a later switch back.
        const pm = new Map<string, { x: number; y: number }>();
        for (const n of g.nodes) pm.set(n.id, n.position);
        tabPos.set(fileId, pm);
        renderedFile = fileId;
        laidOut = g.nodes;
        nodes = g.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            position: n.position,
            initialWidth: n.width,
            initialHeight: n.height,
            data: n.data,
        }));
        // An edge out of a state that can't be retargeted (derived, or a non-faithful SSL node)
        // carries a `locked` flag the custom edge reads to hide its reconnect anchor.
        const lockedSources = new Set(
            editModel.roots.flatMap((r) => r.states).filter((s) => !structEditable(s)).map((s) => s.id),
        );
        edges = g.edges.map((e) => ({
            id: e.id,
            type: "reconnectable",
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            style: edgeStyle(e),
            data: { locked: lockedSources.has(e.source) },
        }));
        if (opts.focusId) focusNode(opts.focusId);
        else if ((opts.frame ?? "entry") === "fit") fitViewport();
        else if ((opts.frame ?? "entry") === "entry") focusEntry();
    }

    // Reset the working copy when the host posts a new model (new file / external edit).
    // Also performs the initial load (effects run on mount).
    // untrack keeps the rebuild's editModel reads from making this re-run on every edit.
    $effect(() => {
        const src = model;
        untrack(() => {
            editModel = cloneModel(src);
            tabPos.clear();
            renderedFile = "";
            activeFile = editModel.roots.find((r) => r.states.length > 0)?.id ?? "";
            selected = null;
            void rebuild({ relayout: true });
        });
    });

    // Switch to a dialog file's tab, optionally framing a target state on arrival.
    function switchTab(fileId: string, focusId?: string): void {
        if (fileId === activeFile) {
            if (focusId) focusNode(focusId);
            return;
        }
        activeFile = fileId;
        selected = null;
        treeCollapsed = new Set();
        void rebuild(focusId ? { focusId } : { frame: "entry" });
    }

    // Clicking an external stub that resolves to another tab jumps there; clicking a card
    // selects it for editing. A dead external stub (destination not in this .d) does nothing.
    function onNodeClick(event: { node: { data?: { state?: DialogState; jumpTo?: { file: string; stateId: string } } } }): void {
        const jump = event.node.data?.jumpTo;
        if (jump) {
            switchTab(jump.file, jump.stateId);
            return;
        }
        selected = event.node.data?.state ?? null;
    }

    // Thin wrappers over the pure edit ops (shared/dialog-edit-ops.ts): each runs the
    // model transform, then relayouts (keeping the viewport mid-edit) and updates
    // selection. The correctness-critical logic (ref-update on rename, redirect on
    // delete, sourceRange handling on duplicate) lives in the tested ops module.
    // A derived state (CHAIN/INTERJECT/EXTEND link) has no source span to splice an edit
    // back into, and SSL has no structural write-back at all, so every structural mutation
    // is rejected here as well as disabled in the inspector - the guard is the backstop in
    // case a control slips through. (Message-text edits are not gated here; they persist for
    // SSL too, via the .msg.)
    const editable = (s: DialogState | null): s is DialogState =>
        s != null && !s.derivedFrom && editModel.editable;

    // Per-node structural editability for the Tier 1 SSL ops (retarget + reorder). A D state
    // tracks the model-level flag; an SSL node is editable only when faithfully representable
    // (DialogState.faithful), so retarget/reorder write back losslessly via applySSLDialogEdits.
    // The other ops (rename/add/remove/delete/duplicate) stay on `editable` - D-only / later tiers.
    const structEditable = (s: DialogState | null): s is DialogState =>
        s != null &&
        !s.derivedFrom &&
        (editModel.editable || (editModel.format === "fallout-ssl" && (s.faithful === true || s.bundleFaithful === true)));

    // Whether a node can be deleted from the graph. A D state: any non-derived state. A faithful SSL node:
    // only when every inbound reference can be cleaned up on save (eligibleToDelete - not an entry, not
    // reached by a `call`, no inbound option in a non-faithful node). eligibleToDelete returns true for D.
    const canDelete = (s: DialogState | null): s is DialogState =>
        structEditable(s) && eligibleToDelete(editModel, s.id);

    // Whether the isEntry toggle can be turned OFF for a given state. Toggling ON is always safe
    // (adds a new entry call). Toggling OFF is only safe when there is a known top-level `talk_p_proc`
    // entry call to remove. A conditional call (`if (X) call NodeY;`) is non-top-level - the save path
    // does not rewrite the `if`, so removing the call would orphan it. A node made an entry by
    // `force_dialog_start`/`start_dialog_at_node` (not a talk_p_proc call) has NO `entryCalls` entry, so
    // the writer cannot un-wire it either; require `topLevel === true` (a real, removable entry call).
    const isEntryRemovable = (s: DialogState): boolean =>
        !s.isEntry || (editModel.entryCalls ?? []).find((ec) => ec.name === s.id)?.topLevel === true;

    const actions = {
        rename: (newId: string) => {
            if (structEditable(selected) && ops.renameState(editModel, selected, newId)) void rebuild({ frame: "none" });
        },
        addReply: () => {
            if (!structEditable(selected)) return; // Tier 2 add option: D or faithful SSL
            ops.addReply(editModel, selected);
            void rebuild({ frame: "none" });
        },
        removeReply: (choiceId: string) => {
            if (!structEditable(selected)) return; // Tier 2 remove option: D or faithful SSL
            ops.removeReply(selected, choiceId);
            void rebuild({ frame: "none" });
        },
        moveReply: (choiceId: string, dir: -1 | 1) => {
            if (!structEditable(selected)) return; // Tier 1 reorder: D or faithful SSL
            ops.moveReply(selected, choiceId, dir);
            void rebuild({ frame: "none" });
        },
        setTarget: (choiceId: string, target: DialogTarget) => {
            if (!structEditable(selected)) return; // Tier 1 retarget: D or faithful SSL
            ops.setChoiceTarget(selected, choiceId, target);
            void rebuild({ frame: "none" });
        },
        deleteState: () => {
            if (!canDelete(selected)) return; // D: any non-derived; SSL: faithful + delete-eligible
            ops.deleteState(editModel, selected);
            selected = null;
            void rebuild({ frame: "none" });
        },
        duplicateState: () => {
            if (!structEditable(selected)) return; // D, or a faithful SSL node (shares the source @N refs)
            const copy = ops.duplicateState(editModel, selected);
            if (!copy) return;
            selected = copy;
            void rebuild({ focusId: copy.id });
        },
        setEntry: (on: boolean) => {
            if (!structEditable(selected)) return;
            selected.isEntry = on;
            void rebuild({ frame: "none" });
        },
        addReplyToBranch: (branchIndex: number) => {
            if (!structEditable(selected)) return; // Tier 3b: bundle SSL branch-scoped add
            const branch = selected.branches?.[branchIndex];
            if (!branch) return;
            ops.addReplyToBranch(editModel, selected, branch);
            void rebuild({ frame: "none" });
        },
        removeReplyInBranch: (branchIndex: number, choiceId: string) => {
            if (!structEditable(selected)) return; // Tier 3b: bundle SSL branch-scoped remove
            const branch = selected.branches?.[branchIndex];
            if (!branch) return;
            ops.removeReplyFromBranch(selected, branch, choiceId);
            void rebuild({ frame: "none" });
        },
        moveReplyInBranch: (branchIndex: number, choiceId: string, dir: -1 | 1) => {
            if (!structEditable(selected)) return; // Tier 3b: bundle SSL branch-scoped reorder
            const branch = selected.branches?.[branchIndex];
            if (!branch) return;
            ops.moveReplyInBranch(selected, branch, choiceId, dir);
            void rebuild({ frame: "none" });
        },
    };

    function addState(): void {
        const s = ops.addState(editModel, activeRoot ?? undefined);
        if (!s) return;
        selected = s;
        void rebuild({ focusId: s.id });
    }

    // Post the edited model to the host, which surgically splices it back into the
    // .d (and persists @N text edits to the .tra). $state.snapshot yields a plain
    // clone safe for the structured-clone postMessage boundary.
    function save(): void {
        postToHost({ type: "save", model: $state.snapshot(editModel) });
    }

    // Point the transition with `choiceId` at the node `targetNodeId` (a state, or the
    // shared EXIT node). Dropping on a synthetic external stub is ignored - cross-file
    // EXTERN retargeting goes through the inspector dropdown. Shared by the two canvas
    // gestures: dragging a node's output handle (onConnect) and dragging an existing
    // edge's endpoint (onReconnect).
    function retargetChoice(choiceId: string, targetNodeId: string): void {
        const states = editModel.roots.flatMap((r) => r.states);
        const owner = states.find((s) => s.choices.some((c) => c.id === choiceId));
        // Only a structurally-editable node (D, or a faithful SSL node) can be retargeted; reject
        // the canvas gesture for derived/non-faithful sources just as the inspector and the locked
        // edge anchor do.
        if (!structEditable(owner ?? null)) return;
        let target: DialogTarget;
        if (targetNodeId === "exit") target = { kind: "exit" };
        else if (states.some((s) => s.id === targetNodeId)) target = { kind: "state", stateId: targetNodeId };
        else return;
        ops.setChoiceTarget(owner, choiceId, target);
        void rebuild({ frame: "none" });
    }

    // Drag a choice's output handle onto a node.
    function onConnect(c: { sourceHandle?: string | null; target?: string }): void {
        if (c.sourceHandle && c.target) retargetChoice(c.sourceHandle, c.target);
    }

    // Drag an existing edge's target endpoint onto a different node. The edge id is the
    // choice id; the new connection's target is the dropped node.
    function onReconnect(oldEdge: { id?: string }, conn: { target?: string }): void {
        if (oldEdge.id && conn.target) retargetChoice(oldEdge.id, conn.target);
    }
</script>

{#snippet toolbar(inGraph: boolean)}
    <span class="viewseg" role="tablist" aria-label="View mode">
        <button class:active={viewMode === "graph"} role="tab" aria-selected={viewMode === "graph"} onclick={() => (viewMode = "graph")}>Graph</button>
        <button class:active={viewMode === "tree"} role="tab" aria-selected={viewMode === "tree"} onclick={() => (viewMode = "tree")}>Tree</button>
    </span>
    {#if hasHost()}
        <!-- Save persists text for both formats (D structure + .tra; SSL message text -> .msg). -->
        <button class="toolbtn save" onclick={save}>Save</button>
    {/if}
    {#if editModel.editable || editModel.format === "fallout-ssl"}
        <button class="toolbtn" onclick={addState}>+ State</button>
    {/if}
    {#if inGraph}
        <button class="toolbtn" title="Re-run auto-layout" onclick={() => void rebuild({ relayout: true, frame: "entry" })}>Re-layout</button>
        <button
            class="toolbtn"
            class:active={spotlight}
            title="Spotlight: dim fully-authored states, highlight only the derived/uncertain ones"
            onclick={() => (spotlight = !spotlight)}
        >
            Spotlight
        </button>
    {/if}
    {#if editModel.format === "weidu-d"}
        <button class="toolbtn" class:active={showSource} onclick={() => (showSource = !showSource)}>Source</button>
    {/if}
    <button class="toolbtn" class:warn={issues.length > 0} class:active={showIssues} onclick={() => (showIssues = !showIssues)}>
        Issues ({issues.length})
    </button>
{/snippet}

{#snippet sourceBox()}
    <pre class="dsource">{sourceText}</pre>
{/snippet}

{#snippet issuesBox()}
    <div class="issues">
        {#if issues.length === 0}
            <div class="ok">No issues found</div>
        {/if}
        {#each issues as iss, i (i)}
            <div class="issue">{iss}</div>
        {/each}
    </div>
{/snippet}

{#snippet inspectorBox(s: DialogState)}
    <Inspector state={s} messages={editModel.messages} {stateIds} {actions} format={editModel.format} editable={editModel.editable} structuralEditable={structEditable(s)} deletable={canDelete(s)} entryRemovable={isEntryRemovable(s)} />
{/snippet}

<svelte:window onkeydown={(e) => e.key === "Escape" && ctxMenu && closeContext()} />

<div class="dialog-graph">
    {#if tabs.length > 1}
        <div class="tabbar" role="tablist">
            {#each tabs as t (t.id)}
                <button class="tab" class:active={t.id === activeFile} role="tab" aria-selected={t.id === activeFile} title={t.label} onclick={() => switchTab(t.id)}>
                    <span class="tname">{t.label}</span>
                    <span class="tcount">{t.states.length}</span>
                </button>
            {/each}
        </div>
    {/if}
    <div class="flowwrap" class:spotlight bind:clientWidth={containerW} bind:clientHeight={containerH}>
        {#if viewMode === "graph"}
            <SvelteFlow bind:nodes bind:edges bind:viewport {nodeTypes} {edgeTypes} onnodeclick={onNodeClick} onconnect={onConnect} onreconnect={onReconnect} nodesDraggable>
                <Background />
                <Controls showFitView={false}>
                    <ControlButton onclick={fitViewport} title="Fit view" aria-label="Fit view">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 9V4a1 1 0 0 1 1-1h5M21 9V4a1 1 0 0 0-1-1h-5M3 15v5a1 1 0 0 0 1 1h5M21 15v5a1 1 0 0 1-1 1h-5" />
                        </svg>
                    </ControlButton>
                </Controls>
                <MiniMap pannable zoomable bgColor="#15171c" maskColor="rgba(10, 12, 16, 0.7)" nodeColor="#3b82f6" nodeStrokeColor="#60a5fa" />
                <Panel position="top-left">{@render toolbar(true)}</Panel>
                <Panel position="top-center">
                    <div class="legend">
                        <span class="lg player">player reply</span>
                        <span class="lg continue">continue</span>
                        <span class="lg exit">exit</span>
                        <span class="lg external">extern</span>
                    </div>
                </Panel>
                {#if showSource}
                    <Panel position="bottom-left">{@render sourceBox()}</Panel>
                {/if}
                {#if showIssues}
                    <Panel position="bottom-center">{@render issuesBox()}</Panel>
                {/if}
                {#if selected}
                    <Panel position="top-right">{@render inspectorBox(selected)}</Panel>
                {/if}
            </SvelteFlow>
        {:else}
            <div class="treewrap">
                <div class="treetoolbar">
                    {@render toolbar(false)}
                    <span class="tbsep"></span>
                    <button class="toolbtn" title="Expand every state" onclick={expandAll}>Expand all</button>
                    <button class="toolbtn" title="Collapse every state" onclick={collapseAll}>Collapse all</button>
                </div>
                <div class="treescroll">
                    {#if treeData.roots.length === 0}
                        <div class="treeempty">No states in this dialog file.</div>
                    {/if}
                    <Tree tree={treeData} selectedId={selected?.id} collapsed={treeCollapsed} onSelect={selectTreeState} onToggle={toggleTreeNode} onJump={treeJump} onContext={openContext} onReplyContext={openReplyContext} />
                </div>
                {#if ctxMenu}
                    <div class="ctxbackdrop" role="presentation" onclick={closeContext} oncontextmenu={(e) => (e.preventDefault(), closeContext())}></div>
                    <div class="ctxmenu" style="left:{ctxMenu.x}px; top:{ctxMenu.y}px" role="menu">
                        {#if ctxOwner?.derivedFrom}
                            <div class="ctxnote">Read-only ({ctxOwner.derivedFrom})</div>
                        {:else if ctxMenu.kind === "state"}
                            <button class="ctxitem" role="menuitem" disabled={!structEditable(ctxOwner)} title={structEditable(ctxOwner) ? "" : "Can't add a reply here - only faithful SSL nodes (or WeiDU D states) are editable."} onclick={() => ctxAct("addReply")}>Add reply</button>
                            <button class="ctxitem" role="menuitem" disabled={!structEditable(ctxOwner)} title={structEditable(ctxOwner) ? "" : "This node can't be duplicated - only faithful SSL nodes (or WeiDU D states) can be."} onclick={() => ctxAct("duplicate")}>Duplicate state</button>
                            <button class="ctxitem del" role="menuitem" disabled={!canDelete(ctxOwner)} title={canDelete(ctxOwner) ? "" : "This node can't be deleted from the graph (a dialog entry, reached by a call, or referenced from non-editable code) - edit the .ssl source."} onclick={() => ctxAct("delete")}>Delete state</button>
                        {:else if ctxReply && !ctxPickTarget}
                            <button class="ctxitem" role="menuitem" disabled={ctxReply.index === 0} onclick={() => replyAct("up")}>Move up</button>
                            <button class="ctxitem" role="menuitem" disabled={ctxReply.index === ctxReply.count - 1} onclick={() => replyAct("down")}>Move down</button>
                            <button class="ctxitem" role="menuitem" onclick={() => (ctxPickTarget = true)}>Set target...</button>
                            <button class="ctxitem del" role="menuitem" onclick={() => replyAct("remove")}>Remove reply</button>
                        {:else if ctxReply}
                            <button class="ctxitem back" role="menuitem" onclick={() => (ctxPickTarget = false)}>&#8592; Set target</button>
                            <div class="ctxlist">
                                <button class="ctxitem" role="menuitem" onclick={() => setReplyTarget({ kind: "exit" })}>EXIT</button>
                                {#each stateIds as id (id)}
                                    <button class="ctxitem" role="menuitem" onclick={() => setReplyTarget({ kind: "state", stateId: id })}>&#8594; {id}</button>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {/if}
                {#if showSource}
                    <div class="tovl bl">{@render sourceBox()}</div>
                {/if}
                {#if showIssues}
                    <div class="tovl bc">{@render issuesBox()}</div>
                {/if}
                {#if selected}
                    <div class="tovl tr">{@render inspectorBox(selected)}</div>
                {/if}
            </div>
        {/if}
    </div>
</div>

<style>
    /* Fill the host (body/#app), not the viewport: `100vw` ignores the scrollbar and,
       with the webview body's default margin, forces a constant horizontal scroll no
       matter the panel width. */
    :global(html),
    :global(body) {
        margin: 0;
        height: 100%;
    }
    :global(body) {
        overflow: hidden;
    }
    :global(#app) {
        height: 100%;
    }
    .dialog-graph {
        width: 100%;
        height: 100%;
        background: #191c21;
        display: flex;
        flex-direction: column;
    }
    /* One tab per destination dialog file. */
    .tabbar {
        flex: 0 0 auto;
        display: flex;
        gap: 2px;
        padding: 4px 6px 0;
        background: #15171c;
        border-bottom: 1px solid #2b303a;
        overflow-x: auto;
    }
    .tab {
        display: flex;
        align-items: center;
        gap: 6px;
        background: #21242b;
        border: 1px solid #2b303a;
        border-bottom: none;
        border-radius: 5px 5px 0 0;
        color: #9aa0a6;
        font-size: 11px;
        padding: 4px 10px;
        cursor: pointer;
        white-space: nowrap;
    }
    .tab:hover {
        color: #cbd5e1;
    }
    .tab.active {
        background: #191c21;
        color: #22d3ee;
        border-color: #3a3f4b;
    }
    .tab .tcount {
        background: #2b303a;
        border-radius: 8px;
        color: #cbd5e1;
        font-size: 9px;
        padding: 0 5px;
    }
    .tab.active .tcount {
        background: #1d4ed8;
        color: #fff;
    }
    .flowwrap {
        flex: 1;
        min-height: 0;
        position: relative;
    }
    /* Spotlight overlay: dim fully-authored cards so the derived/uncertain ones stand out.
       `.card` lives in Node.svelte, so reach it with :global; each card carries `.flagged`
       from model-to-flow when it (or a choice) has any badge. */
    .flowwrap :global(.card) {
        transition: opacity 0.15s ease;
    }
    .flowwrap.spotlight :global(.card:not(.flagged)) {
        opacity: 0.28;
    }
    /* Segmented Graph/Tree switch - the current mode is highlighted. */
    .viewseg {
        display: inline-flex;
        border: 1px solid #3a3f4b;
        border-radius: 4px;
        overflow: hidden;
        margin-right: 6px;
        vertical-align: middle;
    }
    .viewseg button {
        background: #21242b;
        border: none;
        color: #9aa0a6;
        font-size: 12px;
        padding: 4px 10px;
        cursor: pointer;
    }
    .viewseg button:first-child {
        border-right: 1px solid #3a3f4b;
    }
    .viewseg button.active {
        background: #1d4ed8;
        color: #fff;
    }
    /* Tree view: a scrolling outline with the toolbar pinned on top; the inspector,
       source, and issues panels float over it (same affordances as the graph). */
    .treewrap {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        background: #191c21;
    }
    .treetoolbar {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 8px;
        background: #15171c;
        border-bottom: 1px solid #2b303a;
    }
    .tbsep {
        width: 1px;
        align-self: stretch;
        background: #3a3f4b;
        margin: 2px 4px;
    }
    .treescroll {
        flex: 1;
        min-height: 0;
        overflow: auto;
    }
    .treeempty {
        color: #9aa0a6;
        font-size: 12px;
        padding: 16px;
    }
    /* Right-click menu on a tree state row. Fixed-positioned at the cursor; the
       backdrop catches the outside click (and a second right-click) to dismiss it. */
    .ctxbackdrop {
        position: fixed;
        inset: 0;
        z-index: 50;
    }
    .ctxmenu {
        position: fixed;
        z-index: 51;
        min-width: 160px;
        display: flex;
        flex-direction: column;
        padding: 4px;
        background: #21242b;
        border: 1px solid #3a3f4b;
        border-radius: 6px;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
    }
    .ctxitem {
        background: none;
        border: none;
        text-align: left;
        color: #e8eaed;
        font-size: 12px;
        padding: 5px 10px;
        border-radius: 4px;
        cursor: pointer;
    }
    .ctxitem:hover:not(:disabled) {
        background: #2b303a;
    }
    .ctxitem:disabled {
        opacity: 0.4;
        cursor: default;
    }
    .ctxitem.del {
        color: #fca5a5;
    }
    /* "Set target" sub-page: a back row above a scrollable list of same-file targets. */
    .ctxitem.back {
        color: #9aa0a6;
        border-bottom: 1px solid #3a3f4b;
        border-radius: 0;
        margin-bottom: 2px;
    }
    .ctxlist {
        display: flex;
        flex-direction: column;
        max-height: 240px;
        overflow-y: auto;
    }
    .ctxnote {
        color: #fbbf24;
        font-size: 11px;
        padding: 5px 10px;
    }
    /* Float the shared panels over the tree, matching the graph's panel placement. */
    .tovl {
        position: absolute;
        z-index: 5;
    }
    .tovl.tr {
        top: 48px;
        right: 10px;
    }
    .tovl.bl {
        bottom: 10px;
        left: 10px;
    }
    .tovl.bc {
        bottom: 10px;
        left: 50%;
        transform: translateX(-50%);
    }
    .toolbtn {
        background: #2b303a;
        border: 1px solid #3a3f4b;
        border-radius: 4px;
        color: #e8eaed;
        font-size: 12px;
        padding: 4px 10px;
        cursor: pointer;
        margin-right: 4px;
    }
    .toolbtn.active {
        background: #1d4ed8;
        border-color: #3b82f6;
    }
    .toolbtn.warn {
        color: #fca5a5;
        border-color: #7f1d1d;
    }
    .toolbtn.save {
        background: #166534;
        border-color: #22c55e;
        color: #dcfce7;
    }
    /* Svelte Flow ships a light theme (white controls/minimap); theme its chrome to
       the dark editor palette so the controls and minimap aren't blank-white boxes. */
    :global(.svelte-flow__controls) {
        --xy-controls-button-background-color: #2b303a;
        --xy-controls-button-background-color-hover: #3a3f4b;
        --xy-controls-button-color: #e8eaed;
        --xy-controls-button-color-hover: #ffffff;
        --xy-controls-button-border-color: #3a3f4b;
    }
    :global(.svelte-flow__minimap) {
        border: 1px solid #3a3f4b;
        border-radius: 6px;
    }
    /* Larger, clearly-colored handles so a connection is obviously grabbable: drag a
       node's right-edge dot onto another node to relink that transition. */
    :global(.svelte-flow__handle) {
        width: 11px;
        height: 11px;
        border: 1px solid #0b0d10;
    }
    :global(.svelte-flow__handle-right) {
        background: #a3e635;
    }
    :global(.svelte-flow__handle-left) {
        background: #38bdf8;
    }
    /* Draggable dot on each edge (at its midpoint): grab it and drop on a node to
       relink that transition. Subtle by default, brightens on hover. */
    :global(.dlg-reconnect-anchor) {
        background: #f59e0b;
        border: 1px solid #0b0d10;
        border-radius: 50%;
        opacity: 0.55;
        cursor: grab;
    }
    :global(.dlg-reconnect-anchor:hover) {
        opacity: 1;
        box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.35);
    }
    .legend {
        display: flex;
        gap: 10px;
        background: #21242b;
        border: 1px solid #3a3f4b;
        border-radius: 6px;
        padding: 3px 8px;
        font-size: 10px;
        color: #cbd5e1;
    }
    .lg {
        border-left: 8px solid #64748b;
        padding-left: 5px;
    }
    .lg.player {
        border-color: #a3e635;
    }
    .lg.continue {
        border-color: #64748b;
    }
    .lg.exit {
        border-color: #ef4444;
    }
    .lg.external {
        border-color: #f59e0b;
    }
    .issues {
        max-width: 60vw;
        max-height: 22vh;
        overflow: auto;
        background: #21242b;
        border: 1px solid #3a3f4b;
        border-radius: 6px;
        padding: 6px 8px;
        font-size: 11px;
    }
    .issues .ok {
        color: #a3e635;
    }
    .issues .issue {
        color: #fca5a5;
        font-family: monospace;
        font-size: 10px;
        padding: 1px 0;
    }
    .dsource {
        width: 420px;
        max-height: 40vh;
        overflow: auto;
        margin: 0;
        background: #15171c;
        border: 1px solid #3a3f4b;
        border-radius: 6px;
        padding: 8px;
        color: #cbd5e1;
        font-family: monospace;
        font-size: 10px;
        line-height: 1.4;
        white-space: pre;
    }
</style>
