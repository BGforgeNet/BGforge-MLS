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
    import { eligibleToDelete, isLocalNewSSLNode } from "../../../../shared/dialog-ssl-edit";
    import { hasHost, postToHost } from "./host";
    import type { DialogModel, DialogReaction, DialogState, DialogTarget } from "../../../../shared/dialog-model";

    let { model }: { model: DialogModel } = $props();

    const nodeTypes = { card: Node, external: Node, exit: Node };
    const edgeTypes = { reconnectable: ReconnectEdge };

    // Below this canvas width the minimap is hidden: it would sit atop the bottom-left zoom
    // controls, and a minimap of a canvas this small is not useful. The live editor shares the
    // VS Code window (ViewColumn.Beside), so a narrow canvas is the common case, not an edge one.
    const MINIMAP_MIN_W = 320;

    // Working copy the editor mutates. The `model` prop is the host's last-posted state; the
    // debounced emit effect below posts editModel back to the host as it changes.
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
    // Cap the floating top-left toolbar to the canvas width (minus the svelte-flow panel's ~15px inset
    // each side) so it wraps DOWN within the canvas instead of overflowing right into the docked rail.
    // A percentage max-width can't do this - the absolutely-positioned panel sizes to its content, not
    // the canvas. Floored so an unmeasured (0) width doesn't yield a negative cap.
    const graphbarMax = $derived(Math.max(containerW - 30, 80));
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
    // A delete that would silently redirect inbound transitions to EXIT waits on this confirmation.
    let confirmDelete = $state<{ state: DialogState; refCount: number } | null>(null);

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

    // Switching to the Tree view unmounts SvelteFlow (the `{#if viewMode}` block); switching back
    // remounts it with its internal viewport reset to the origin, which drops the entry node under the
    // top-left toolbar Panel. Re-frame the entry once the remount has settled (rAF, so the flow exists
    // and containerW/H are measured) so the first card never sits beneath the toolbar.
    $effect(() => {
        if (viewMode !== "graph") return;
        const raf = requestAnimationFrame(() => focusEntry());
        return () => cancelAnimationFrame(raf);
    });

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
            confirmDelete = null;
            void rebuild({ relayout: true });
            suppressEmit = true;
        });
    });

    // Debounce window for coalescing an edit burst (rapid keystrokes in one field) into a single host edit.
    const EMIT_DEBOUNCE_MS = 250;

    // suppressEmit is a PLAIN (non-reactive) flag - see the emit-design note. The reset effect sets it true
    // before replacing editModel from a host {type:"model"} message so the emit effect's next run does not
    // echo the host's own model back.
    let suppressEmit = true;

    // Emit every user edit to the host (production only). A single effect deep-reads editModel via
    // $state.snapshot, so ANY mutation - structural op OR inline inspector field edit - re-runs it. The host
    // splices the model into the live document as one WorkspaceEdit (one native undo step) and side-writes
    // message text to .tra. $state.snapshot yields a plain clone safe for the postMessage boundary (a raw
    // $state proxy throws DataCloneError). The effect-cleanup clears the pending timer, giving both the
    // debounce (prior timer cancelled before each re-run) and teardown safety (no post after unmount).
    $effect(() => {
        const snapshot = $state.snapshot(editModel); // deep-read: tracks every nested field
        if (!hasHost()) return; // standalone harness: no host to post to
        if (suppressEmit) {
            suppressEmit = false;
            return;
        }
        const timer = setTimeout(() => postToHost({ type: "edit", model: snapshot }), EMIT_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    });

    // Reconcile message from the host (production only). After the host commits a just-added option/node to the
    // source it allocates the item's `@N` id but the echo guard suppresses the re-project that would give it a
    // real source span (to keep selection/in-progress text). This message carries the allocated ids + .msg text
    // so we mark those pending items committed IN PLACE - which stops the next save re-splicing (duplicating)
    // them - without dropping selection or the text being typed. suppressEmit keeps this host-driven mutation
    // from echoing straight back as an edit. The body reads no reactive state, so the listener registers once.
    $effect(() => {
        function onReconcile(e: MessageEvent): void {
            const d = e.data as
                | { type?: string; allocations?: Record<string, string>; messages?: Record<string, string> }
                | null;
            if (d?.type !== "reconcile" || !d.allocations) return;
            suppressEmit = true;
            ops.applyReconcile(editModel, d.allocations, d.messages);
            void rebuild({ frame: "none" });
        }
        window.addEventListener("message", onReconcile);
        return () => window.removeEventListener("message", onReconcile);
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
    // A locally-added SSL node (isLocalNewSSLNode) is editable immediately: it has no `faithful` flag yet
    // (only the parser sets that, on the next save round-trip), but we created it, so it is safe to edit,
    // delete, and add options to. Without this a freshly-added node stays greyed out until a save.
    const structEditable = (s: DialogState | null): s is DialogState =>
        s != null &&
        !s.derivedFrom &&
        (editModel.editable ||
            (editModel.format === "fallout-ssl" &&
                (s.faithful === true || s.bundleFaithful === true || isLocalNewSSLNode(s))));

    // Whether a node can be deleted from the graph. A D state: any non-derived state. A faithful SSL node:
    // only when every inbound reference can be cleaned up on save (eligibleToDelete - not an entry, not
    // reached by a `call`, no inbound option in a non-faithful node). eligibleToDelete returns true for D.
    const canDelete = (s: DialogState | null): s is DialogState =>
        structEditable(s) && eligibleToDelete(editModel, s.id);

    // Actually remove the state (after the confirm modal, or directly when there are no inbound refs).
    function performDelete(s: DialogState): void {
        ops.deleteState(editModel, s);
        selected = null;
        confirmDelete = null;
        void rebuild({ frame: "none" });
    }

    // Single gate for a delete request from ANY path - the inspector Delete button, the tree context
    // menu, or the Delete/Backspace key. Rejects non-deletable nodes, confirms first when inbound
    // transitions would be redirected to EXIT, else deletes. svelte-flow's built-in delete key is
    // disabled (deleteKey={null}) so it cannot bypass this and drop a flow node while leaving the
    // model's GOTOs dangling.
    function requestDeleteState(s: DialogState | null): void {
        if (!canDelete(s)) return; // D: any non-derived; SSL: faithful + delete-eligible
        const refs = ops.countInboundGotos(editModel, s.id);
        if (refs > 0) {
            confirmDelete = { state: s, refCount: refs };
            return;
        }
        performDelete(s);
    }

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
        setReaction: (choiceId: string, reaction: DialogReaction) => {
            if (!structEditable(selected)) return; // SSL only: reaction (N/G/B) macro rewrite
            ops.setChoiceReaction(selected, choiceId, reaction);
            void rebuild({ frame: "none" });
        },
        setLowIq: (choiceId: string, on: boolean) => {
            if (!structEditable(selected)) return; // SSL only: low-INT variant (arg-count) rewrite
            ops.setChoiceLowIq(selected, choiceId, on);
            void rebuild({ frame: "none" });
        },
        deleteState: () => requestDeleteState(selected),
        duplicateState: () => {
            if (!structEditable(selected)) return; // D, or a faithful SSL node (shares the source @N refs)
            const copy = ops.duplicateState(editModel, selected);
            if (!copy) return;
            selected = copy;
            void rebuild({ focusId: copy.id });
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
        addBranch: (condition: string) => {
            if (!structEditable(selected)) return; // Tier 3c: append a new if-branch to a bundle node
            ops.addBranch(selected, condition);
            void rebuild({ frame: "none" });
        },
        addElse: () => {
            if (!structEditable(selected)) return; // Tier 3c: append an else-branch to a single-if bundle
            ops.addElse(selected); // no-op if precondition not met (handled inside the op)
            void rebuild({ frame: "none" });
        },
        removeBranch: (branchIndex: number) => {
            if (!structEditable(selected)) return; // Tier 3c: remove a branch from a bundle node
            const branch = selected.branches?.[branchIndex];
            if (!branch) return;
            ops.removeBranch(selected, branchIndex);
            void rebuild({ frame: "none" });
        },
    };

    function addState(): void {
        const s = ops.addState(editModel, activeRoot ?? undefined);
        if (!s) return;
        selected = s;
        void rebuild({ focusId: s.id });
    }

    // Window keydown: Escape dismisses the tree context menu. A text edit is in progress when focus is
    // in an input/textarea/select (or contenteditable) - in the docked inspector, the source box, etc.
    // Backspace/Delete there edits text, never a node.
    function isEditableTarget(t: EventTarget | null): boolean {
        const el = t as HTMLElement | null;
        const tag = el?.tagName;
        return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable === true;
    }

    function onWindowKeydown(e: KeyboardEvent): void {
        if (e.key === "Escape" && ctxMenu) {
            closeContext();
            return;
        }
        // Delete/Backspace removes the selected state through the guarded path (confirm + inbound-ref
        // redirect), not svelte-flow's built-in delete (disabled below). Skipped while typing in a
        // field, and while the confirm modal is already open.
        if ((e.key === "Delete" || e.key === "Backspace") && selected && !confirmDelete && !isEditableTarget(e.target)) {
            e.preventDefault();
            requestDeleteState(selected);
        }
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
    <Inspector state={s} messages={editModel.messages} {stateIds} {actions} format={editModel.format} editable={editModel.editable} structuralEditable={structEditable(s)} deletable={canDelete(s)} />
{/snippet}

<svelte:window onkeydown={onWindowKeydown} />

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
    <div class="body">
    <div class="flowwrap" class:spotlight bind:clientWidth={containerW} bind:clientHeight={containerH}>
        {#if viewMode === "graph"}
            <!-- deleteKey={null}: svelte-flow's built-in delete would drop the flow node/edge without
                 touching the model, leaving dangling GOTOs; node deletion goes through requestDeleteState
                 (Delete/Backspace in onWindowKeydown) so it is confirmed and redirects inbound refs. -->
            <SvelteFlow bind:nodes bind:edges bind:viewport {nodeTypes} {edgeTypes} deleteKey={null} onnodeclick={onNodeClick} onconnect={onConnect} onreconnect={onReconnect} nodesDraggable>
                <Background />
                <Controls showFitView={false}>
                    <ControlButton onclick={fitViewport} title="Fit view" aria-label="Fit view">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 9V4a1 1 0 0 1 1-1h5M21 9V4a1 1 0 0 0-1-1h-5M3 15v5a1 1 0 0 0 1 1h5M21 15v5a1 1 0 0 1-1 1h-5" />
                        </svg>
                    </ControlButton>
                </Controls>
                {#if containerW >= MINIMAP_MIN_W}
                    <MiniMap pannable zoomable bgColor="#15171c" maskColor="rgba(10, 12, 16, 0.7)" nodeColor="#3b82f6" nodeStrokeColor="#60a5fa" />
                {/if}
                <!-- Toolbar + legend share ONE top-left flex-wrap container so they can never collide: a
                     separate top-center legend was overwritten by the variable-width toolbar (Source/Issues
                     buttons hidden behind it). Capped to the canvas width (graphbarMax) so it wraps DOWN
                     within the canvas at narrow widths instead of overflowing into the docked rail. -->
                <Panel position="top-left">
                    <div class="graphbar" style="max-width: {graphbarMax}px">
                        {@render toolbar(true)}
                        <div class="legend">
                            <span class="lg player">player reply</span>
                            <span class="lg continue">continue</span>
                            <span class="lg exit">exit</span>
                            <span class="lg external">extern</span>
                        </div>
                    </div>
                </Panel>
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
            </div>
        {/if}
    </div>
    <!-- Shared docked rail (both graph and tree modes): the inspector, D source, and issues panels
         dock here beside the canvas instead of floating over it. Floating panels collided with the
         canvas chrome (minimap, zoom controls, one another) at the narrow width the live webview runs
         at (it shares the VS Code window). Docking them out of the canvas removes the whole collision
         class and unifies the two view modes' auxiliary panels, which previously duplicated this. -->
    {#if selected || showSource || showIssues}
        <aside class="siderail">
            {#if selected}{@render inspectorBox(selected)}{/if}
            {#if showSource}{@render sourceBox()}{/if}
            {#if showIssues}{@render issuesBox()}{/if}
        </aside>
    {/if}
    </div>
    {#if confirmDelete}
        <div class="modalback" role="presentation" onclick={() => (confirmDelete = null)}></div>
        <div class="confirm" role="alertdialog" aria-modal="true" aria-label="Confirm delete">
            <div class="confirmmsg">
                Delete <b>{confirmDelete.state.id}</b>? {confirmDelete.refCount}
                transition{confirmDelete.refCount === 1 ? "" : "s"} pointing here will be redirected to
                <b>EXIT</b>.
            </div>
            <div class="confirmbtns">
                <button class="toolbtn" onclick={() => (confirmDelete = null)}>Cancel</button>
                <button class="toolbtn confirmdel" onclick={() => { if (confirmDelete) performDelete(confirmDelete.state); }}>Delete</button>
            </div>
        </div>
    {/if}
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
    /* Row holding the canvas and the docked side rail. */
    .body {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: row;
    }
    /* Canvas column: the graph/tree fills this; the docked rail sits beside it. */
    .flowwrap {
        flex: 1 1 0;
        min-width: 0;
        min-height: 0;
        position: relative;
    }
    /* Docked auxiliary panels (inspector / source / issues), beside the canvas rather than floating
       over it. Capped so the canvas keeps at least half at the narrow widths the webview runs at;
       scrolls vertically when the stacked panels are tall. */
    .siderail {
        flex: 0 0 auto;
        width: min(340px, 50%);
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px;
        overflow-y: auto;
        background: #191c21;
        border-left: 1px solid #2b303a;
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
        /* Wrap like the graph's .graphbar: on a narrow canvas a non-wrapping row shrinks its items,
           and the .viewseg (overflow:hidden) then clips its own Graph/Tree buttons to nothing -
           stranding the user in Tree view. Wrapping keeps every control visible and within the canvas
           column, so it never crowds the docked rail. */
        flex-wrap: wrap;
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
    /* Confirm modal for a delete that would silently redirect inbound transitions to EXIT. */
    .modalback {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
        z-index: 60;
    }
    .confirm {
        position: fixed;
        z-index: 61;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        max-width: 320px;
        background: #21242b;
        border: 1px solid #3a3f4b;
        border-radius: 8px;
        padding: 14px;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
        color: #e8eaed;
        font-size: 12px;
    }
    .confirmmsg {
        line-height: 1.45;
        margin-bottom: 12px;
    }
    .confirmmsg b {
        color: #fcd34d;
    }
    .confirmbtns {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }
    .confirmdel {
        color: #fca5a5;
        border-color: #7f1d1d;
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
    /* Toolbar + legend in one row that wraps within itself. Capped to the canvas width so a wrapped
       toolbar grows DOWN inside its own panel, never past the canvas edge. The inspector no longer
       floats top-right (it docks in `.siderail`), so no extra column needs reserving here. */
    .graphbar {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        max-width: 100%;
    }
    .legend {
        display: flex;
        /* Wrap the key entries so a narrow canvas doesn't clip "exit"/"extern" under the rail edge -
           they are a fixed vocabulary, so they must all stay legible rather than hard-cut. */
        flex-wrap: wrap;
        gap: 4px 10px;
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
        /* Continue edges render dashed in the graph; show that in the key so the style is documented. */
        border-left-style: dashed;
    }
    .lg.exit {
        border-color: #ef4444;
    }
    .lg.external {
        border-color: #f59e0b;
    }
    .issues {
        width: 100%;
        box-sizing: border-box;
        max-height: 30vh;
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
        width: 100%;
        box-sizing: border-box;
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
