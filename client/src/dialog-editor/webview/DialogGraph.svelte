<script lang="ts">
    import {
        SvelteFlow,
        Background,
        Controls,
        ControlButton,
        MiniMap,
        Panel,
        type Node as XyNode,
        type Edge as XyEdge,
    } from "@xyflow/svelte";
    import "@xyflow/svelte/dist/style.css";
    import { tick, untrack } from "svelte";
    import Node from "./Node.svelte";
    import Inspector from "./Inspector.svelte";
    import ReconnectEdge from "./ReconnectEdge.svelte";
    import Tree from "./Tree.svelte";
    import { modelToFlow, type FlowNode, type FlowEdge } from "./model-to-flow";
    import { buildConversationTree, childStates, type ConvState } from "./conversation-tree";
    import { collectMatches } from "./tree-search";
    import { isPendingChoice, writeText } from "./inspector-edit";
    import { dialogIssues } from "./dialog-issues";
    import { distinctStateIds, findStateInRoots, remapChoiceId } from "./state-lookup";
    import { translationHint, unresolvedRefCount } from "./translation-status";
    import { findCallers, type CallerRow } from "./find-callers";
    import { classifyReachability } from "../../../../shared/dialog-reachability";
    import type { DialogActions } from "./dialog-actions";
    import { decideReparse, type ReparseMessage } from "./reparse-decision";
    import { resolveJumpTarget } from "./jump-resolve";
    import { layoutFlow } from "./layout";
    import { modelToD } from "../../../../shared/dialog-d-serialize";
    import * as ops from "../../../../shared/dialog-edit-ops";
    import { hasSourceSpans, nodeDeletable, nodeEditable } from "../../../../shared/dialog-editability";
    import { hasHost, postToHost } from "./host";
    import {
        renderFamily,
        resolveText,
        sslTerminalKind,
        type DialogChoice,
        type DialogMessages,
        type DialogModel,
        type DialogReaction,
        type DialogState,
        type DialogTarget,
    } from "../../../../shared/dialog-model";

    let { model }: { model: DialogModel } = $props();

    const nodeTypes = { card: Node, external: Node, exit: Node, combat: Node };
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
    // untrack: capture the model prop ONCE into the working copy. Later host posts are adopted
    // imperatively (see the adopt-in-place machinery below), never by re-deriving editModel - so this
    // read is deliberately non-reactive, not a missing $derived.
    let editModel = $state<DialogModel>(untrack(() => cloneModel(model)));

    // The GRAPH projection is imperative - rebuild() writes nodes/edges - while every other model
    // projection here (treeData, tabs, issues, searchMatches, ...) is $derived and refreshes on any
    // mutation with no per-path wiring. Deliberate asymmetry, not drift: the graph pipeline is async
    // (elkjs layout) and stateful (per-tab position caches, live drag positions merged back in),
    // neither of which a synchronous $derived can express - so a model mutation must call rebuild(),
    // and only for the graph. $state.raw because Svelte Flow swaps/mutates the arrays internally.
    let nodes = $state.raw<XyNode[]>([]);
    let edges = $state.raw<XyEdge[]>([]);
    let selected = $state<DialogState | null>(null);
    // The individually-selected option within `selected`, when the user clicks an option row in the tree
    // (null when a whole state is selected). Highlights that option in the tree and drives the docked
    // Inspector to scroll to + focus its edit field. Only meaningful alongside `selected`; cleared on any
    // state-level selection so it never mis-highlights an option of a different state.
    let selectedChoiceId = $state<string | null>(null);
    // The option currently being edited inline in the tree (its text is an input), or null. Set by a
    // double-click / Enter / F2 in the tree, and by adding a new option (which drops straight into edit).
    let editingChoiceId = $state<string | null>(null);
    // The state whose NPC line is being edited inline in the tree (its line renders as an input), or null.
    // Set by double-clicking the line / F2 on the row. Mirrors editingChoiceId for the option text; only one
    // of the two is ever set at a time (beginning either edit clears the other).
    let editingStateId = $state<string | null>(null);
    // The state whose node id is being renamed inline in the tree (its id label renders as an input), or null.
    // Set by F2 / double-clicking the id. Mutually exclusive with editingStateId/editingChoiceId (beginning a
    // rename clears the text edits and vice-versa) - only one inline edit runs at a time.
    let renamingStateId = $state<string | null>(null);
    // The if/else branch highlighted in the tree, set by clicking a branch line (its path key), or null. Purely
    // a tree highlight - selection stays at the node level. Cleared whenever a different node/option is selected.
    let highlightedBranchKey = $state<string | null>(null);
    // The editor's selection is ONE state plus at most one mutually-exclusive UI sub-mode. `select` is the
    // single setter that writes the whole tuple (`selected` + the five flags above) coherently, so no entry
    // point hand-resets a subset - the co-varying-state-one-setter rule (architecture.md). Modelled as a
    // discriminated union so an impossible combination (editing an option AND renaming the node) can't be
    // expressed. Adding a sub-mode is a one-line change here, not an edit spread across every selection site.
    type Selection =
        | { on: "state"; state: DialogState | null } // whole state selected (or nothing, on state: null)
        | { on: "option"; state: DialogState; choiceId: string } // an option row selected
        | { on: "option-edit"; state: DialogState; choiceId: string } // an option's text in inline edit
        | { on: "line-edit"; state: DialogState } // the NPC line in inline edit
        | { on: "rename"; state: DialogState } // the node id in inline rename
        | { on: "branch"; state: DialogState; branchKey: string | undefined }; // an if/else branch highlighted
    function select(sel: Selection): void {
        selected = sel.state;
        selectedChoiceId = sel.on === "option" || sel.on === "option-edit" ? sel.choiceId : null;
        editingChoiceId = sel.on === "option-edit" ? sel.choiceId : null;
        editingStateId = sel.on === "line-edit" ? sel.state.id : null;
        renamingStateId = sel.on === "rename" ? sel.state.id : null;
        highlightedBranchKey = sel.on === "branch" ? (sel.branchKey ?? null) : null;
    }
    // "Auto node names" toggle (default on): keep auto-assigning NodeXXX / StateXXX ids when adding a node.
    // Off routes node creation through a prompt for the name (nameModal below).
    let autoNodeNames = $state(true);
    // Open manual-name prompt for a pending node creation (toggle off). `kind` selects which creation to run on
    // confirm: a bare "+ State", or an "add child" that also wires an option from `parentId` to the new node.
    // `value` is the editable name (pre-filled with the suggested id), `error` the current validation message.
    let nameModal = $state<{ kind: "state" | "child"; parentId?: string; value: string; error: string } | null>(null);
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
    let viewMode = $state<"graph" | "tree">("tree");

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
    // dialog; cross-file links are EXTERN and handled separately. Deduped: a root can repeat a
    // state label (two CHAIN blocks sharing a terminal label), and a keyed {#each} over the raw
    // ids would raise svelte's each_key_duplicate; a jump target is a label, so distinct is correct.
    // Target-picker id list. On SSL the reserved terminals (Node998/Node999) are presented as the Combat/Exit
    // picker entries, not raw ids, so drop them here (they would otherwise appear as `-> Node998` in the menus).
    const isSSL = $derived(renderFamily(editModel.sourceLang) === "fallout-ssl");
    const stateIds = $derived(
        distinctStateIds(activeRoot?.states ?? []).filter((id) => !isSSL || !sslTerminalKind(id)),
    );
    // How many @N refs failed to resolve to real text (the tra/msg path isn't found). Drives the banner
    // below - otherwise a misconfigured translation dir silently renders every line as its raw @N ref.
    const unresolvedRefs = $derived(unresolvedRefCount(editModel));
    // Family-specific words for the unresolved-refs banner (Fallout SSL `.msg` vs WeiDU D `.tra`).
    const traHint = $derived(translationHint(isSSL));
    // Live serialization of the edited model back to WeiDU D. Only D is serializable;
    // recomputes as edits mutate editModel (a save path will post this to the host).
    const sourceText = $derived(showSource && editModel.sourceLang === "d" ? modelToD(editModel) : "");
    let showIssues = $state(false);
    // A delete that would silently redirect inbound transitions to EXIT waits on this confirmation.
    let confirmDelete = $state<{ state: DialogState; refCount: number } | null>(null);

    // Inline validation surfaced in the Issues panel: a dangling GOTO (target state no longer exists) and
    // duplicate labels are the errors that break a saved .d. Pure and tested in dialog-issues.ts (the
    // per-root scoping and derived-state exclusion are the parts that regress into false positives).
    const issues = $derived(dialogIssues(editModel));

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
            ? buildConversationTree(activeRoot, editModel.messages, (label) => resolveJumpTarget(label, stateToRoot, fileToRoot), {
                  ssl: renderFamily(editModel.sourceLang) === "fallout-ssl",
                  // The SAME per-state predicate the graph/inspector gate on, so the tree's text lock matches
                  // the inspector (a .td state is field-editable even though editModel.editable is false).
                  fieldEditable: (s) => structEditable(s),
                  sourceless: !hasSourceSpans(editModel),
              })
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
    // Un-collapse the given states so a reveal target (a jump/ref/graph selection) that sits inside a
    // collapsed branch actually renders and can be scrolled to. Reassigns the set (reactive) only if it changed.
    function expandTreeStates(ids: string[]): void {
        const next = new Set(treeCollapsed);
        let changed = false;
        for (const id of ids) if (next.delete(id)) changed = true;
        if (changed) treeCollapsed = next;
    }
    // Go to source (F4): ask the host to open the .ssl/.d text editor at this byte offset. The host owns the
    // document and the byte->position conversion (see panel.ts revealSource).
    function goToSource(sourceOffset: number): void {
        postToHost({ type: "revealSource", offset: sourceOffset });
    }
    // Every collapsible state in the current tree (each ConvState appears once). Walks children via the shared
    // `childStates` so branch/block nodes' children are collapsed too, matching the tree's reveal/search walks.
    function allTreeStateIds(): string[] {
        const ids: string[] = [];
        const walk = (s: ConvState): void => {
            ids.push(s.id);
            for (const k of childStates(s)) walk(k);
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

    // ---- Find in tree ----------------------------------------------------------------------------------
    // An always-visible find-bar over the active tab's outline (tree view): highlight every row whose visible
    // text (or node id) matches the query, and step through the matches with Enter / Shift+Enter (wrapping). It
    // drives the same select + reveal path a click uses, so a match auto-expands its collapsed ancestors and
    // scrolls into view, and selection stays coupled to the current match (never decoupled).
    let searchQuery = $state("");
    let searchIndex = $state(0);
    let searchInput: HTMLInputElement | undefined = $state();
    // True only while the find input holds keyboard focus. Gates Tree's focus-follows-selection: while the user
    // is typing/navigating in the box, find-as-you-type must not yank focus onto each match's row (that drops
    // characters); when focus is in the tree instead, selection focuses its row normally.
    let searchInputFocused = $state(false);
    // Opt-in "search in code" toggle (default off, per-session only): also hit-test triggers, conditions, and
    // actions, not just dialogue - see tree-search.ts's includeCode option and its default rationale.
    let searchIncludeCode = $state(false);
    // Matches recompute on every model edit, query change, or includeCode toggle (treeData is derived), so a
    // match always points at a live row. Empty when the query is blank (collectMatches returns []).
    const searchMatches = $derived(collectMatches(treeData, searchQuery, { includeCode: searchIncludeCode }));
    // Row keys to highlight (all matches) and the current match's key (emphasized). The key namespaces don't
    // collide - see tree-search.ts.
    const searchHits = $derived(new Set(searchMatches.map((m) => m.key)));
    const currentMatchKey = $derived(searchMatches[searchIndex]?.key ?? null);

    // Select + reveal the i-th match, reusing the tree's own selection handlers (which scroll it into view and
    // un-collapse its ancestors). An out-of-range index (no matches) is a no-op.
    function goToMatch(i: number): void {
        const m = searchMatches[i];
        if (!m) return;
        searchIndex = i;
        if (m.choiceId) selectReplyInTree(m.stateId, m.choiceId);
        else if (m.branchKey) selectBranchInTree(m.stateId, m.branchKey);
        else selectTreeState(m.stateId);
    }
    const nextMatch = (): void => {
        if (searchMatches.length > 0) goToMatch((searchIndex + 1) % searchMatches.length);
    };
    const prevMatch = (): void => {
        if (searchMatches.length > 0) goToMatch((searchIndex - 1 + searchMatches.length) % searchMatches.length);
    };
    // Find-as-you-type: `searchQuery` is already updated by bind:value, so reset to the first match and jump to
    // it (reading searchMatches recomputes the derived for the new query). A blank query clears matches without
    // moving selection.
    function onQueryChanged(): void {
        searchIndex = 0;
        if (searchMatches.length > 0) goToMatch(0);
    }
    function focusSearch(): void {
        // Ctrl+F jumps to the always-visible find box and selects any existing query for quick replace.
        void tick().then(() => {
            searchInput?.focus();
            searchInput?.select();
        });
    }
    function clearSearch(): void {
        searchQuery = "";
        searchIndex = 0;
        searchInput?.blur(); // hand focus back to the tree
    }

    // Resolve within the ACTIVE root first: state ids are not unique across roots (a D file's several DLGs
    // reuse labels), and a first-match-across-all-roots lookup returned the wrong instance for a duplicated
    // id - so "Set target" acted on a state that did not own the choice (target silently unchanged) and
    // selection jumped to the wrong state. See state-lookup.ts.
    function findState(stateId: string): DialogState | null {
        return findStateInRoots(editModel.roots, activeFile, stateId);
    }
    // Tree-row click: select the state for the shared Inspector. `select` clears any option selection/edit -
    // selecting the whole state is a state-level action.
    function selectTreeState(stateId: string): void {
        const s = findState(stateId);
        if (s) select({ on: "state", state: s });
    }
    // Tree branch-line click: select the owner state (so the inspector follows) AND highlight that branch's run
    // in the tree. A top-level unconditional line passes no key - it just selects the state (no branch highlight).
    function selectBranchInTree(stateId: string, branchKey: string | undefined): void {
        const s = findState(stateId);
        if (s) select({ on: "branch", state: s, branchKey });
    }
    // Tree option-row click: select the option (and its owner state) so the tree highlights it and the
    // docked Inspector scrolls to + highlights its field. Single-click does not enter inline edit - that is
    // a double-click / Enter / F2 (beginEditReply).
    function selectReplyInTree(stateId: string, choiceId: string): void {
        const s = findState(stateId);
        if (s) select({ on: "option", state: s, choiceId });
    }
    // Breadcrumb "back to state" from the focused-option Inspector: drop the option focus but keep the state
    // selected, so the Inspector falls back to the whole-state editor.
    function focusOwnerState(): void {
        if (selected) select({ on: "state", state: selected });
    }
    // Tree option double-click / Enter / F2: enter inline edit on the option's text.
    function beginEditReply(stateId: string, choiceId: string): void {
        const s = findState(stateId);
        if (s) select({ on: "option-edit", state: s, choiceId });
    }
    // Commit an inline edit via writeText (a resolvable @N line updates its .msg/.tra entry; anything else - a
    // literal, or a just-added option - updates the choice's own text, allocated an @id at save). Then leave
    // edit mode (option stays selected) and reproject.
    function commitEditReply(stateId: string, choiceId: string, value: string): void {
        if (adoptRestoreInFlight) return; // blur from the adopt's own DOM churn, not a user gesture
        const s = findState(stateId);
        const c = s?.choices.find((ch) => ch.id === choiceId);
        if (!s) return;
        select(c ? { on: "option", state: s, choiceId } : { on: "state", state: s });
        if (!c) return;
        writeText(c, editModel.messages, value);
        void rebuild({ frame: "none" });
    }
    // Abandon an inline edit (Escape) - discard the draft, leave edit mode, keep the option selected.
    function cancelEditReply(): void {
        if (adoptRestoreInFlight) return; // blur from the adopt's own DOM churn, not a user gesture
        if (selected)
            select(selectedChoiceId ? { on: "option", state: selected, choiceId: selectedChoiceId } : { on: "state", state: selected });
    }

    // Tree NPC-line double-click / Enter / E: enter inline edit on the state's NPC line. Selects the state (so
    // the inspector follows) and clears any option edit / rename - only one inline edit runs at a time. (F2 is
    // node rename, not line edit - see beginRenameState.)
    function beginEditState(stateId: string): void {
        const s = findState(stateId);
        if (s) select({ on: "line-edit", state: s });
    }
    // Commit an inline NPC-line edit via writeText (a resolvable @N line updates its .msg/.tra entry; a literal
    // - or a just-added state - updates the state's own text, allocated an @id at save). Mirrors
    // commitEditReply. Then leave edit mode (state stays selected) and reproject.
    function commitEditState(stateId: string, value: string): void {
        if (adoptRestoreInFlight) return; // blur from the adopt's own DOM churn, not a user gesture
        const s = findState(stateId);
        if (!s) return;
        select({ on: "state", state: s });
        writeText(s, editModel.messages, value);
        void rebuild({ frame: "none" });
    }
    // Abandon an inline NPC-line edit (Escape) - discard the draft, keep the state selected.
    function cancelEditState(): void {
        if (adoptRestoreInFlight) return; // blur from the adopt's own DOM churn, not a user gesture
        if (selected) select({ on: "state", state: selected });
    }

    // Tree F2 / id double-click: begin an inline node-id rename. Selects the state (so the inspector follows)
    // and clears any text edit - only one inline edit runs at a time. Gated on structEditable, matching the
    // inspector's rename field and the tree's own F2 gate (a read-only/derived node cannot be renamed).
    function beginRenameState(stateId: string): void {
        const s = findState(stateId);
        if (structEditable(s)) select({ on: "rename", state: s });
    }
    // Commit an inline rename: renameState moves the label and every GOTO/EXTERN reference with it (see the op).
    // A rejected id (empty, unchanged, or a duplicate) leaves the model as-is and the row reverts to the old id
    // on reproject. Leave rename mode either way (the renamed - or unchanged - node stays selected).
    function commitRenameState(stateId: string, value: string): void {
        if (adoptRestoreInFlight) return; // blur from the adopt's own DOM churn, not a user gesture
        const s = findState(stateId);
        if (s && ops.renameState(editModel, s, value)) {
            select({ on: "state", state: s }); // keep the just-renamed node selected (its id changed)
            void rebuild({ frame: "none" });
        } else if (selected) {
            select({ on: "state", state: selected }); // rejected: leave rename mode, keep the current selection
        }
    }
    // Abandon an inline rename (Escape) - discard the draft, keep the state selected under its current id.
    function cancelRenameState(): void {
        if (adoptRestoreInFlight) return; // blur from the adopt's own DOM churn, not a user gesture
        if (selected) select({ on: "state", state: selected });
    }

    // Select a state, switching to its tab first if it lives in another dialog (a caller can be cross-root).
    function navigateToState(stateId: string): void {
        const rootId = stateToRoot.get(stateId);
        if (rootId && rootId !== activeFile) switchTab(rootId, stateId);
        selectTreeState(stateId);
    }

    // "Referenced by": inbound references to the selected state, resolved to display rows (who reaches this
    // node - options, calls, the talk_p_proc entry, or an external force_dialog_start entry). Choice ids are
    // globally unique, so the referencing option's text is looked up across all states.
    const callerRows = $derived.by((): CallerRow[] => {
        if (!selected) return [];
        const allChoices = editModel.roots.flatMap((r) => r.states).flatMap((s) => s.choices);
        return findCallers(editModel, selected.id).map((c): CallerRow => {
            if (c.kind === "entry") return { kind: c.kind, label: "talk_p_proc (dialog entry)" };
            if (c.kind === "external-entry")
                return { kind: c.kind, label: "force_dialog_start / start_dialog_at_node" };
            const choice = allChoices.find((ch) => ch.id === c.choiceId);
            const text = choice ? resolveText(choice.text, editModel.messages) : "";
            const verb = c.kind === "call" ? "call" : "option";
            return { kind: c.kind, fromStateId: c.fromStateId, label: `${c.fromStateId} (${verb})${text ? ": " + text : ""}` };
        });
    });

    // Reachability class of the selected state - the same honest three-way signal (reachable / external-entry /
    // orphan) the graph already tags cards with. Recomputed when the model structure changes; looked up per
    // selection. Lets the inspector's "Referenced by" note tell a real orphan (inbound refs but no path from an
    // entry) from an entry point that merely has no in-file inbound (WeiDU D top-level states, SSL EXTERN banter).
    const reachByState = $derived(classifyReachability(editModel));
    const selectedReachability = $derived(selected ? reachByState.get(selected.id) : undefined);

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

    // Open at the raw cursor position; `clampToViewport` (below) nudges the menu back on-screen using its
    // MEASURED size after render. The old fixed 300px bottom reservation pushed even the short 3-item state
    // menu well above the cursor for any right-click in the lower part of the viewport.
    function openContext(stateId: string, x: number, y: number): void {
        ctxPickTarget = false;
        ctxMenu = { kind: "state", x, y, stateId };
    }
    function openReplyContext(stateId: string, choiceId: string, index: number, count: number, x: number, y: number): void {
        ctxPickTarget = false;
        ctxMenu = { kind: "reply", x, y, stateId, choiceId, index, count };
    }
    const closeContext = (): void => {
        ctxMenu = null;
        ctxPickTarget = false;
    };
    // Svelte action: place the context menu at (x, y), then clamp it back inside the viewport using its
    // ACTUAL measured size, so neither the short state menu nor the tall target-picker page opens
    // off-screen. Re-runs when the coords or the target-picker sub-page change (the two pages differ in
    // height). Writes to the element's style directly (not to $state), so there is no update loop.
    function clampToViewport(el: HTMLElement, _coords: [number, number, boolean]) {
        const place = ([x, y]: [number, number, boolean]): void => {
            const r = el.getBoundingClientRect();
            el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - r.width - 8))}px`;
            el.style.top = `${Math.max(8, Math.min(y, window.innerHeight - r.height - 8))}px`;
        };
        place(_coords);
        return { update: place };
    }
    function ctxAct(kind: "addReply" | "duplicate" | "delete"): void {
        const st = ctxMenu ? findState(ctxMenu.stateId) : null;
        closeContext();
        if (!st || st.derivedFrom) return;
        select({ on: "state", state: st });
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
        select({ on: "state", state: st });
        if (kind === "remove") actions.removeReply(choiceId);
        else actions.moveReply(choiceId, kind === "up" ? -1 : 1);
    }
    function setReplyTarget(target: DialogTarget): void {
        if (ctxMenu?.kind !== "reply") return;
        const { stateId, choiceId } = ctxMenu;
        closeContext();
        const st = findState(stateId);
        if (!st || st.derivedFrom) return;
        select({ on: "state", state: st });
        actions.setTarget(choiceId, target);
    }
    // Tree cross-file leaf: switch to the destination tab and select the target there.
    function treeJump(file: string, stateId: string): void {
        switchTab(file, stateId);
        selectTreeState(stateId);
    }

    function edgeStyle(e: FlowEdge): string {
        // Same token choices as the canvas legend below (.lg.player/.lg.continue/.lg.exit/.lg.external) so an
        // edge's colour always matches its legend entry. `var(--vscode-*)` resolves fine here - Svelte Flow
        // applies this string as a real DOM `style` attribute on the SVG path, not an SVG presentation attribute.
        const color =
            e.kind === "back"
                ? "var(--vscode-editorWarning-foreground)"
                : e.category === "combat"
                  ? "var(--vscode-errorForeground)"
                  : e.category === "exit"
                    ? "var(--vscode-errorForeground)"
                    : e.category === "external"
                      ? "var(--vscode-editorWarning-foreground)"
                      : e.category === "player"
                        ? "var(--vscode-charts-green)"
                        : "var(--vscode-descriptionForeground)";
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
            editModel.roots
                .flatMap((r) => r.states)
                .filter((s) => !structEditable(s))
                // `!structEditable` (a `s is DialogState` guard) narrows s to `never`; annotate the widened
                // type back since the filtered states are still DialogStates at runtime.
                .map((s: DialogState) => s.id),
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

    // The inline-edit sub-mode open at adopt time, so the same edit reopens on the adopted model.
    type EditMode = "option-edit" | "line-edit" | "rename" | null;

    // Re-select the same logical target after adopting a freshly-parsed model in place: the state by id, and its
    // option by id - remapped through `allocations` for a just-added option, whose id changes across the parse
    // (see remapChoiceId). An open inline edit re-enters the same sub-mode on the remapped target (its live
    // draft/caret are restored separately - see adoptModel's overlay). Falls back to a whole-state selection
    // (or nothing) when the target is gone from the new parse (e.g. deleted in the source).
    function reselectAfterAdopt(
        keep: {
            id: string;
            choiceId: string | null;
            choiceIndex: number;
            choiceCount: number;
            branchKey: string | null;
            mode: EditMode;
        } | null,
        allocations: Record<string, string> | undefined,
    ): void {
        if (!keep) return select({ on: "state", state: null });
        const s = findState(keep.id);
        if (!s) return select({ on: "state", state: null }); // the selected node vanished from the source
        if (keep.choiceId !== null) {
            let cid = remapChoiceId(keep.choiceId, s, allocations);
            // Positional fallback: a pending option with EMPTY text gets no `@N` (the allocator skips empty
            // text), so neither its old id nor an allocation can find it in the adopted parse - exactly the
            // "+ option, reparse lands before the first keystroke commits" window. Splices and parses both
            // preserve choice order, so with an UNCHANGED choice count the option's index identifies it.
            if (cid === null && keep.choiceIndex >= 0 && s.choices.length === keep.choiceCount) {
                cid = s.choices[keep.choiceIndex]?.id ?? null;
            }
            if (cid !== null && keep.mode === "option-edit") return select({ on: "option-edit", state: s, choiceId: cid });
            return select(cid !== null ? { on: "option", state: s, choiceId: cid } : { on: "state", state: s });
        }
        if (keep.mode === "line-edit") return select({ on: "line-edit", state: s });
        if (keep.mode === "rename") return select({ on: "rename", state: s });
        if (keep.branchKey !== null) return select({ on: "branch", state: s, branchKey: keep.branchKey });
        select({ on: "state", state: s });
    }

    // The inline-edit inputs are UNCONTROLLED - the DOM holds the draft until a blur commits it - so
    // replacing editModel re-renders the input from the MODEL's text and would drop what the user has
    // typed. Capture the live draft + caret from the focused input before the adopt, and re-seed the
    // (possibly recreated) input after the render flush. This overlay is what lets an authoritative
    // reparse land mid-typing without data loss - the job the old "reconcile the optimistic model in
    // place" branch existed for, at a fraction of its machinery.
    function captureEditDraft(): { draft: string; selStart: number | null; selEnd: number | null } | null {
        const el = document.activeElement;
        if (!(el instanceof HTMLInputElement)) return null;
        return { draft: el.value, selStart: el.selectionStart, selEnd: el.selectionEnd };
    }
    // True while an adopt is re-mounting the inline-edit input. The DOM churn of replacing the model blurs
    // the OLD input (the fresh one steals focus via autofocusSelect), and that blur runs the commit/cancel
    // handlers - which would exit the just-restored edit mode and unmount the input. A blur inside this
    // window is the adopt's own artifact, not a user gesture, so the handlers no-op on the flag.
    let adoptRestoreInFlight = false;
    async function restoreEditDraft(d: { draft: string; selStart: number | null; selEnd: number | null }): Promise<void> {
        try {
            await tick(); // the re-entered edit mode mounts (or re-renders) its input on this flush
            const el = document.querySelector<HTMLInputElement>("input.rtextedit, input.lineedit, input.nameedit");
            if (!el) return; // the target lost its editability in the new parse - nothing to re-seed
            el.value = d.draft;
            el.focus();
            if (d.selStart !== null && d.selEnd !== null) el.setSelectionRange(d.selStart, d.selEnd);
        } finally {
            adoptRestoreInFlight = false;
        }
    }

    // Adopt an authoritative parsed model IN PLACE for the current file: replace the working copy with it but
    // keep the selection on its logical target (by identity) and the tab's laid-out positions. This is the
    // "faithful tree" path shared by a self-edit's re-parse (via the listener below) and an external text-side
    // edit to the same file. `messages` merges any freshly-allocated .msg text the debounced .tra flush has not
    // written yet, so a just-typed line renders as text, not a raw `@N`. Building the merged model before the
    // single `editModel =` assignment keeps the emit effect to one (suppressed) run.
    function adoptModel(next: DialogModel, allocations?: Record<string, string>, messages?: DialogMessages): void {
        const mode: EditMode =
            editingChoiceId !== null
                ? "option-edit"
                : editingStateId !== null
                  ? "line-edit"
                  : renamingStateId !== null
                    ? "rename"
                    : null;
        const keep = selected
            ? {
                  id: selected.id,
                  choiceId: selectedChoiceId,
                  choiceIndex: selectedChoiceId
                      ? selected.choices.findIndex((c) => c.id === selectedChoiceId)
                      : -1,
                  choiceCount: selected.choices.length,
                  branchKey: highlightedBranchKey,
                  mode,
              }
            : null;
        const draft = mode !== null ? captureEditDraft() : null;
        // Pending options with EMPTY reply text exist only in this webview - the writers defer their
        // splice until the text commits (see dialog-d-edit's spliceableView / the SSL family's
        // isAllocatedNewOption), so the adopted parse can never contain them. Carry them over at their
        // positions, or a reparse landing right after "+ option" silently removes the row mid-edit.
        const pendingEmpty: { rootId: string; stateId: string; index: number; choice: DialogChoice }[] = [];
        for (const r of editModel.roots) {
            for (const s of r.states) {
                s.choices.forEach((c, i) => {
                    if (c.text !== undefined && c.text.trim() === "" && isPendingChoice(c)) {
                        pendingEmpty.push({
                            rootId: r.id,
                            stateId: s.id,
                            index: i,
                            choice: $state.snapshot(c) as DialogChoice,
                        });
                    }
                });
            }
        }
        const merged = cloneModel(next);
        if (messages && Object.keys(messages).length > 0) merged.messages = { ...merged.messages, ...messages };
        suppressEmit = true;
        editModel = merged;
        if (!editModel.roots.some((r) => r.id === activeFile)) {
            activeFile = editModel.roots.find((r) => r.states.length > 0)?.id ?? "";
        }
        for (const p of pendingEmpty) {
            const s = editModel.roots.find((r) => r.id === p.rootId)?.states.find((st) => st.id === p.stateId);
            if (s && !s.choices.some((c) => c.id === p.choice.id)) {
                s.choices.splice(Math.min(p.index, s.choices.length), 0, p.choice);
            }
        }
        // A pending delete-confirmation holds a state REFERENCE into the replaced model; re-resolve it in
        // the adopted one (by id) so confirming operates on live objects, or close it if the state is gone.
        if (confirmDelete) {
            const again = findState(confirmDelete.state.id);
            confirmDelete = again ? { state: again, refCount: confirmDelete.refCount } : null;
        }
        reselectAfterAdopt(keep, allocations);
        if (draft) {
            adoptRestoreInFlight = true;
            void restoreEditDraft(draft);
        }
        void rebuild({ frame: "none" });
    }

    // The host posts a model on the initial load, a new file, and every external text-side edit (App.svelte
    // routes those through the `model` prop). A DIFFERENT file (or the very first load, before anything is laid
    // out) does a full reset + relayout; the SAME file is an external edit we adopt in place, keeping selection
    // on its node so the tree stays a faithful view without losing the user's place. (A self-edit's re-parse is
    // `reparse:true` and handled by the listener below, not here.) untrack keeps the rebuild's editModel reads
    // from re-running this on every edit.
    $effect(() => {
        const src = model;
        untrack(() => {
            const sameFile = renderedFile !== "" && src.sourceName === editModel.sourceName;
            if (sameFile) {
                adoptModel(src);
                return;
            }
            suppressEmit = true;
            editModel = cloneModel(src);
            tabPos.clear();
            renderedFile = "";
            activeFile = editModel.roots.find((r) => r.states.length > 0)?.id ?? "";
            select({ on: "state", state: null });
            confirmDelete = null;
            void rebuild({ relayout: true });
        });
    });

    // Debounce window for coalescing an edit burst (rapid keystrokes in one field) into a single host edit.
    const EMIT_DEBOUNCE_MS = 250;

    // suppressEmit is a PLAIN (non-reactive) flag - see the emit-design note. The reset effect / adoptModel set
    // it true before replacing editModel from a host model message so the emit effect's next run does not echo
    // the host's own model back.
    let suppressEmit = true;
    // Monotonic id stamped on each emitted edit and echoed back on the host's re-parse. The re-parse listener
    // applies only the re-parse for the LATEST emit (seq === localSeq); an older one would clobber a newer
    // optimistic edit the user has already made. Plain (non-reactive): it drives no rendering.
    let localSeq = 0;

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
        const timer = setTimeout(() => postToHost({ type: "edit", model: snapshot, seq: ++localSeq }), EMIT_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    });

    // Re-parse message from the host (production only): after it splices a self-edit into the source, the host
    // posts the faithful parse (`reparse:true`) so the tree becomes a pure view of source - real spans (F4
    // resolves), canonical ids. The ignore/adopt routing (stale-seq drop) is the pure kernel in
    // reparse-decision.ts, unit-tested there (its module doc records WHY this optimistic-model-plus-adopt
    // shape is used instead of a pure text-authoritative projection - it turns on the async LSP parse
    // boundary). EVERY accepted reparse adopts - an open inline edit survives the replacement via adoptModel's
    // draft overlay rather than blocking it, so the model is never left optimistic and stale-range/pending-
    // state bookkeeping has nothing to track. The body reads no reactive state at registration, so the
    // listener registers once.
    $effect(() => {
        function onReparse(e: MessageEvent): void {
            const decision = decideReparse(e.data as ReparseMessage | null, localSeq);
            if (decision.kind === "ignore") return;
            adoptModel(decision.model, decision.allocations, decision.messages);
        }
        window.addEventListener("message", onReparse);
        return () => window.removeEventListener("message", onReparse);
    });

    // Switch to a dialog file's tab, optionally framing a target state on arrival.
    function switchTab(fileId: string, focusId?: string): void {
        if (fileId === activeFile) {
            if (focusId) focusNode(focusId);
            return;
        }
        activeFile = fileId;
        select({ on: "state", state: null });
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
        // Graph card click routes through the same `select` as a tree click - so it clears the rename mode and
        // branch highlight a tree action may have left set, not just the option/line-edit flags it used to.
        select({ on: "state", state: event.node.data?.state ?? null });
    }

    // Thin wrappers over the pure edit ops (shared/dialog-edit-ops.ts): each runs the
    // model transform, then relayouts (keeping the viewport mid-edit) and updates
    // selection. The correctness-critical logic (ref-update on rename, redirect on
    // delete, sourceRange handling on duplicate) lives in the tested ops module.
    // Per-node editability lives in the shared `nodeEditable`/`nodeDeletable` predicates (one definition the
    // inspector shares, so the two views can never disagree). Field and structural editability coincide now, so
    // there is one predicate, not the former structEditable/fieldEditable pair. These thin closures bind the model
    // and preserve the `s is DialogState` narrowing the template filters and handlers rely on.
    const structEditable = (s: DialogState | null): s is DialogState => nodeEditable(editModel, s);
    const canDelete = (s: DialogState | null): s is DialogState => nodeDeletable(editModel, s);

    // Ids of the active root's structurally-editable states, for the tree's inline add/remove-option
    // affordances (the "+" row and the per-option hover "x"). Same derivation the graph uses for
    // `lockedSources`, scoped to the active root because the tree renders one root at a time.
    const editableTreeStateIds = $derived(
        new Set((activeRoot?.states ?? []).filter((s) => structEditable(s)).map((s) => s.id)),
    );
    // Ids of states that can be deleted right now (canDelete: structurally editable AND every inbound
    // reference can be cleaned up on save). Drives whether the tree's inline "-" is enabled vs shown
    // disabled with an explanatory tooltip.
    const deletableTreeStateIds = $derived(
        new Set((activeRoot?.states ?? []).filter((s) => canDelete(s)).map((s) => s.id)),
    );

    // Append an option to a state and reproject. Returns the new choice so the caller can select/edit it.
    function appendReply(st: DialogState): DialogChoice {
        const c = ops.addReply(editModel, st);
        void rebuild({ frame: "none" });
        return c;
    }
    // The ONE "add a flat option, then select + edit it" path - shared by the tree "+ option", the inspector
    // "+", and the context-menu "Add option", so every surface behaves identically (share-don't-duplicate).
    // A just-added option is always text-editable (pending), so dropping into edit is safe for D and SSL alike.
    function addOptionAndEdit(st: DialogState): void {
        const c = appendReply(st);
        select({ on: "option-edit", state: st, choiceId: c.id });
    }
    // The ONE "remove an option" path. If the removed option was the selected one, fall selection back to its
    // owner state so no stale choiceId lingers (a removed option cannot stay selected).
    function removeOption(st: DialogState, choiceId: string): void {
        ops.removeReply(st, choiceId);
        if (selectedChoiceId === choiceId) select({ on: "state", state: st });
        void rebuild({ frame: "none" });
    }
    // Remove the currently-selected OPTION via the shared remove path, IF it is removable - the same gate its
    // row `x` uses: a structurally-editable, flat (non-branch) node, and not a conditional SSL option (that sits
    // in its own `if` the writer won't rewrite - optionRemoveLockReason). An unremovable or branch option is a
    // no-op here, exactly like the disabled `x`, never a surprise delete of the parent node. Lets Del act on the
    // selected option so the keyboard, the row `x`, and the context menu are one delete gesture.
    function removeSelectedOption(): void {
        if (!selected || !selectedChoiceId || selected.branches) return;
        const choice = selected.choices.find((c) => c.id === selectedChoiceId);
        if (!choice || !structEditable(selected)) return;
        if (isSSL && choice.condition) return;
        removeOption(selected, selectedChoiceId);
    }
    // Tree inline "+ option": add an option to a state addressed by id (the row need not be the current
    // selection), through the shared add path.
    function addReplyToState(stateId: string): void {
        const st = findState(stateId);
        if (structEditable(st)) addOptionAndEdit(st);
    }
    // Tree inline "x": remove an option from a state addressed by id, through the shared remove path. The tree
    // gates a conditional SSL option's "x" as disabled (matching the inspector), so this is only reached for a
    // removable option.
    function removeReplyFromState(stateId: string, choiceId: string): void {
        const st = findState(stateId);
        if (structEditable(st)) removeOption(st, choiceId);
    }
    // Grow the conversation from a state - add a new NPC child state and an option here that leads to it, then
    // SELECT THE NEW STATE (so the inspector shows it, ready for its line), matching the toolbar "+ State". The
    // connecting option starts empty and is edited by selecting it. `id` is the chosen node name (manual-name
    // path) or undefined to auto-assign.
    function createChildNode(parentId: string, id?: string): void {
        const st = findState(parentId);
        if (!structEditable(st)) return;
        const child = ops.addState(editModel, activeRoot ?? undefined, id);
        const c = ops.addReply(editModel, st);
        ops.setChoiceTarget(st, c.id, { kind: "state", stateId: child.id });
        select({ on: "state", state: child });
        void rebuild({ frame: "none" });
    }
    // Tree inline node "+": add a child node. With "Auto node names" on, create straight away; off, prompt for
    // the name first (nameModal), then createChildNode runs on confirm.
    function addChildNode(stateId: string): void {
        const st = findState(stateId);
        if (!structEditable(st)) return;
        if (autoNodeNames) createChildNode(stateId);
        else nameModal = { kind: "child", parentId: stateId, value: ops.suggestStateId(editModel), error: "" };
    }
    // Tree inline node "-": delete a state addressed by id, through the same guarded path as the inspector
    // Delete / Backspace (requestDeleteState confirms when inbound transitions would be redirected to EXIT).
    function deleteStateFromTree(stateId: string): void {
        const st = findState(stateId);
        if (!canDelete(st)) return;
        select({ on: "state", state: st });
        requestDeleteState(st);
    }

    // Actually remove the state (after the confirm modal, or directly when there are no inbound refs).
    function performDelete(s: DialogState): void {
        ops.deleteState(editModel, s);
        select({ on: "state", state: null });
        confirmDelete = null;
        void rebuild({ frame: "none" });
    }

    // Single gate for a delete request from ANY path - the inspector Delete button, the tree context
    // menu, or the Delete/Backspace key. Rejects non-deletable nodes, confirms first when inbound
    // transitions would be redirected to EXIT, else deletes. svelte-flow's built-in delete key is
    // disabled (deleteKey={null}) so it cannot bypass this and drop a flow node while leaving the
    // model's GOTOs dangling.
    function requestDeleteState(s: DialogState | null): void {
        if (!s) return; // nothing selected - Del is a no-op
        const label = s.id; // capture before `!canDelete` (a `s is DialogState` guard) narrows s to never
        if (!canDelete(s)) {
            // The tree/inspector delete affordances are already disabled for a non-deletable node, but the Del
            // KEY still reaches here - so explain why instead of doing nothing (a silent no-op reads as "Del is
            // broken"; the reported "Del doesn't work" was pressing it on the entry node).
            if (hasHost())
                postToHost({
                    type: "notify",
                    level: "warn",
                    text: `"${label}" can't be deleted from the graph - it's a dialog entry, reached by a call, or referenced from non-editable code. Remove it in the ${renderFamily(editModel.sourceLang) === "fallout-ssl" ? ".ssl" : ".d"} source.`,
                });
            return;
        }
        const refs = ops.countInboundGotos(editModel, s);
        if (refs > 0) {
            confirmDelete = { state: s, refCount: refs };
            return;
        }
        performDelete(s);
    }

    const actions: DialogActions = {
        rename: (newId: string) => {
            if (structEditable(selected) && ops.renameState(editModel, selected, newId)) void rebuild({ frame: "none" });
        },
        addReply: () => {
            if (structEditable(selected)) addOptionAndEdit(selected); // Tier 2 add option: D or faithful SSL
        },
        removeReply: (choiceId: string) => {
            if (structEditable(selected)) removeOption(selected, choiceId); // Tier 2 remove option: D or faithful SSL
        },
        moveReply: (choiceId: string, dir: -1 | 1) => {
            if (!structEditable(selected)) return; // reorder writes back to source for every family (D/SSL/td/tssl)
            ops.moveReply(selected, choiceId, dir);
            void rebuild({ frame: "none" });
        },
        setTarget: (choiceId: string, target: DialogTarget) => {
            if (!structEditable(selected)) return; // retarget: D, faithful SSL/TSSL, or a faithful/new td node
            ops.setChoiceTarget(selected, choiceId, target);
            void rebuild({ frame: "none" });
        },
        setReaction: (choiceId: string, reaction: DialogReaction) => {
            // Reaction (N/G/B macro rewrite) is a Fallout-SSL-family concept: real SSL and TSSL. It has no D-family
            // (d/td) equivalent and the reaction control never renders there; guard anyway for keyboard paths.
            if (!structEditable(selected) || (editModel.sourceLang !== "ssl" && editModel.sourceLang !== "tssl")) return;
            ops.setChoiceReaction(selected, choiceId, reaction);
            void rebuild({ frame: "none" });
        },
        setLowIq: (choiceId: string, on: boolean) => {
            // Low-INT (arg-count) rewrite is also SSL-family only (real SSL + TSSL).
            if (!structEditable(selected) || (editModel.sourceLang !== "ssl" && editModel.sourceLang !== "tssl")) return;
            ops.setChoiceLowIq(selected, choiceId, on);
            void rebuild({ frame: "none" });
        },
        deleteState: () => requestDeleteState(selected),
        duplicateState: () => {
            if (!structEditable(selected)) return; // D, or a faithful SSL node (shares the source @N refs)
            const copy = ops.duplicateState(editModel, selected);
            if (!copy) return;
            select({ on: "state", state: copy });
            void rebuild({ focusId: copy.id });
        },
        addReplyToBranch: (branchIndex: number) => {
            if (!structEditable(selected)) return; // Tier 3b: bundle SSL branch-scoped add
            const branch = selected.branches?.[branchIndex];
            if (!branch) return;
            // Select + edit the new branch option, same as the flat add path (addOptionAndEdit).
            const c = ops.addReplyToBranch(editModel, selected, branch);
            select({ on: "option-edit", state: selected, choiceId: c.id });
            void rebuild({ frame: "none" });
        },
        removeReplyInBranch: (branchIndex: number, choiceId: string) => {
            if (!structEditable(selected)) return; // Tier 3b: bundle SSL branch-scoped remove
            const branch = selected.branches?.[branchIndex];
            if (!branch) return;
            ops.removeReplyFromBranch(selected, branch, choiceId);
            if (selectedChoiceId === choiceId) select({ on: "state", state: selected }); // drop stale option selection
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

    function createState(id?: string): void {
        const s = ops.addState(editModel, activeRoot ?? undefined, id);
        select({ on: "state", state: s });
        void rebuild({ focusId: s.id });
    }
    // Toolbar "+ State": create a node. "Auto node names" on -> create straight away with an auto id; off ->
    // prompt for the name first (nameModal), then createState runs on confirm.
    function addState(): void {
        if (autoNodeNames) createState();
        else nameModal = { kind: "state", value: ops.suggestStateId(editModel), error: "" };
    }
    // Confirm the manual-name prompt: validate the entered name and, on success, run the pending creation with
    // it. A rejected name keeps the modal open with the reason. `newStateIdError` centralizes the rules (unique,
    // and for SSL a valid procedure identifier not colliding with a reserved sink).
    function confirmNameModal(): void {
        if (!nameModal) return;
        const err = ops.newStateIdError(editModel, nameModal.value, activeRoot ?? undefined);
        if (err) {
            nameModal.error = err;
            return;
        }
        const m = nameModal;
        const id = m.value.trim();
        nameModal = null;
        if (m.kind === "state") createState(id);
        else if (m.parentId) createChildNode(m.parentId, id);
    }
    function cancelNameModal(): void {
        nameModal = null;
    }
    // Focus + select the name input when the prompt opens (svelte action on mount).
    function focusSelectModal(el: HTMLInputElement): void {
        el.focus();
        el.select();
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
        // The delete-confirm modal has no input of its own to hang a key handler on (unlike the name
        // prompt), so its Escape-to-dismiss lives here with the other window-level keys.
        if (e.key === "Escape" && confirmDelete) {
            confirmDelete = null;
            return;
        }
        // Ctrl/Cmd+F focuses the always-visible tree find-bar (tree view only - the graph has no scrollable
        // outline to search). Allowed while focus is in a field so it works from anywhere.
        if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F") && viewMode === "tree") {
            e.preventDefault();
            focusSearch();
            return;
        }
        // F4 in the GRAPH view goes to the selected node's source, mirroring the Tree view (whose own rows
        // handle F4). Gated to graph mode so it never double-fires with a tree row's F4 - that bubbles to the
        // window too (the row only preventDefaults, it doesn't stop propagation). A synthetic/derived node has
        // no span, so the offset is absent and this is a no-op. Uses the same state span the tree row does
        // (SSL `procRange`, else D `sourceRange`).
        if (e.key === "F4" && viewMode === "graph" && selected && !isEditableTarget(e.target)) {
            e.preventDefault();
            const offset = selected.procRange?.start ?? selected.sourceRange?.start;
            if (offset != null) goToSource(offset);
            return;
        }
        // Delete/Backspace removes the selected state through the guarded path (confirm + inbound-ref
        // redirect), not svelte-flow's built-in delete (disabled below). Skipped while typing in a
        // field, and while the confirm modal is already open.
        if ((e.key === "Delete" || e.key === "Backspace") && selected && !confirmDelete && !isEditableTarget(e.target)) {
            e.preventDefault();
            // Del acts on WHATEVER is selected, so the legend "Del delete" is honest: a selected OPTION is
            // removed (or a no-op when it is locked/branch); with no option selected, the selected STATE is
            // deleted through the guarded path (confirm + inbound-ref redirect).
            if (selectedChoiceId) removeSelectedOption();
            else requestDeleteState(selected);
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
        if (!owner || !structEditable(owner)) return;
        let target: DialogTarget;
        if (targetNodeId === "exit") target = { kind: "exit" };
        // The Combat terminal (SSL Node998) is a synthetic node, not a model state; map a drop on it back to a
        // faithful `state -> Node998` target so it serializes as a `call Node998` the parser round-trips.
        // `isSSL`-gated: the combat terminal only exists on an SSL graph, so a D graph can never reach this.
        else if (isSSL && targetNodeId === "combat") target = { kind: "state", stateId: "Node998" };
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
        <button class:active={viewMode === "tree"} role="tab" aria-selected={viewMode === "tree"} onclick={() => (viewMode = "tree")}>Tree</button>
        <button class:active={viewMode === "graph"} role="tab" aria-selected={viewMode === "graph"} onclick={() => (viewMode = "graph")}>Graph</button>
    </span>
    <!-- `editable` is the blanket-editable flag (true only for D); ssl/td/tssl leave it false but are
         per-node editable (see shared/dialog-model.ts), so add-state is offered for every editable family. -->
    {#if editModel.editable || editModel.sourceLang === "ssl" || editModel.sourceLang === "tssl" || editModel.sourceLang === "td"}
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
    {#if editModel.sourceLang === "d"}
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
    <Inspector state={s} messages={editModel.messages} {stateIds} {actions} format={renderFamily(editModel.sourceLang)} sourceLang={editModel.sourceLang} sourceName={editModel.sourceName} editable={editModel.editable} structuralEditable={structEditable(s)} deletable={canDelete(s)} callers={callerRows} reachability={selectedReachability} {selectedChoiceId} {highlightedBranchKey} onNavigate={navigateToState} onFocusOwnerState={focusOwnerState} />
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
    <!-- One docked toolbar header shared by BOTH views. Previously the graph floated its toolbar over the
         canvas (a svelte-flow Panel, zero layout height) while the tree docked a header that consumed
         height - so switching views made the canvas jump. A single docked header keeps the height constant. -->
    <div class="dialogtoolbar">
        <!-- Left column: (1) beta/feedback, (2) the button row. The keyboard reference is a full-height panel
             docked on the RIGHT (tree view only), so it no longer consumes a third stacked row. -->
        <div class="tbleft">
            <!-- Row 1: beta / feedback notice, matching the binary editor's toolbar-beta. -->
            <div class="tbrow tbbeta">
                <span class="dlgbeta">
                    Beta. Send feedback to
                    <a href="https://github.com/BGforgeNet/BGforge-MLS/issues" target="_blank" rel="noreferrer"
                       >https://github.com/BGforgeNet/BGforge-MLS/issues</a>
                </span>
            </div>
            <!-- Row 2: buttons - the view switch + actions (tree adds Expand/Collapse all), then the
                 "Auto node names" toggle at the END of the list. -->
            <div class="tbrow">
                {@render toolbar(viewMode === "graph")}
                {#if viewMode === "tree"}
                    <span class="tbsep"></span>
                    <button class="toolbtn" title="Expand every state" onclick={expandAll}>Expand all</button>
                    <button class="toolbtn" title="Collapse every state" onclick={collapseAll}>Collapse all</button>
                {/if}
                <!-- Same blanket-editable caveat as the "+ State" gate above: ssl/td/tssl are per-node
                     editable though `editable` is false, so this toggle shows for every editable family. -->
                {#if editModel.editable || editModel.sourceLang === "ssl" || editModel.sourceLang === "tssl" || editModel.sourceLang === "td"}
                    <label class="tbtoggle" title="On: new nodes get an auto-assigned name (SSL NodeXXX / D StateXXX). Off: you're prompted for the name each time.">
                        <input type="checkbox" bind:checked={autoNodeNames} />
                        Auto node names
                    </label>
                {/if}
            </div>
            {#if viewMode === "tree"}
                <!-- Row 3: always-visible find-bar. Non-destructive - it highlights matches and steps through
                     them, never filtering the outline. Enter / Shift+Enter walk matches (wrapping); Escape clears. -->
                <div class="tbrow tbfind">
                    <!-- bind:value is the correct two-way idiom here; while the input holds focus, Tree's
                         focus-follows-selection effect is gated by searchActive (searchInputFocused) so
                         find-as-you-type doesn't yank focus onto each match and drop characters. -->
                    <input
                        class="findinput"
                        type="text"
                        placeholder="Find node, line, or option text"
                        aria-label="Find in dialogue"
                        bind:this={searchInput}
                        bind:value={searchQuery}
                        oninput={onQueryChanged}
                        onfocus={() => (searchInputFocused = true)}
                        onblur={() => (searchInputFocused = false)}
                        onkeydown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                if (e.shiftKey) prevMatch();
                                else nextMatch();
                            } else if (e.key === "Escape") {
                                e.preventDefault();
                                clearSearch();
                            }
                        }}
                    />
                    <span class="findcount" role="status">
                        {#if searchQuery.trim() === ""}
                            &nbsp;
                        {:else if searchMatches.length === 0}
                            No matches
                        {:else}
                            {searchIndex + 1}/{searchMatches.length}
                        {/if}
                    </span>
                    <button class="toolbtn findnav" title="Previous match (Shift+Enter)" aria-label="Previous match" onclick={prevMatch} disabled={searchMatches.length === 0}>&lt;</button>
                    <button class="toolbtn findnav" title="Next match (Enter)" aria-label="Next match" onclick={nextMatch} disabled={searchMatches.length === 0}>&gt;</button>
                    <button class="toolbtn findnav" title="Clear search (Escape)" aria-label="Clear search" onclick={clearSearch} disabled={searchQuery === ""}>x</button>
                    <!-- Opt-in code search: off by default (a condition/trigger/action is code, not dialogue -
                         see tree-search.ts). Reruns the search and jumps to the first match on toggle, same as
                         find-as-you-type (onQueryChanged's reset-and-jump applies equally to a match-set change
                         from this toggle). -->
                    <label class="tbtoggle" title="On: also search node triggers, choice conditions/actions, and branch conditions. Off: dialogue text only.">
                        <input type="checkbox" bind:checked={searchIncludeCode} onchange={onQueryChanged} />
                        Code
                    </label>
                </div>
            {/if}
        </div>
        {#if viewMode === "tree"}
            <!-- Tree keyboard reference: a full-height panel on the RIGHT (the bindings live per row in
                 Tree.svelte / window-wide for Delete; this only surfaces them). Tree view only - they are
                 outline-specific, so showing them over the graph canvas would mislead. -->
            <div class="tbright">
                <span class="keyhints">
                    <span><kbd>Up</kbd>/<kbd>Down</kbd> move</span>
                    <span><kbd>Left</kbd>/<kbd>Right</kbd> fold</span>
                    <span><kbd>Enter</kbd>/<kbd>E</kbd> edit line</span>
                    <span><kbd>F2</kbd> rename node</span>
                    <span><kbd>G</kbd> go to target</span>
                    <span><kbd>F4</kbd> source</span>
                    <span><kbd>Ctrl+F</kbd> find</span>
                    <span><kbd>Del</kbd> delete</span>
                </span>
            </div>
        {/if}
    </div>
    {#if unresolvedRefs > 0}
        <!-- Make a silent resolution failure legible: without a resolvable tra/msg path, getMessages returns
             nothing and every line renders as its raw @N. Tell the author how to point the path rather than
             leaving the whole conversation unreadable with no explanation. -->
        <div class="untra" role="status">
            <b>{unresolvedRefs}</b> message ref{unresolvedRefs === 1 ? "" : "s"} show as <code>@N</code> - translations aren't resolved.
            {#if editModel.sourceLang === "dlg"}
                <!-- A compiled dialog holds strrefs into the game's dialog.tlk, not a .tra path, and it is
                     binary so it has no first line to annotate. The tra advice below would send a reader
                     after a file that does not exist for this format. -->
                Its text lives in the game's <b>dialog.tlk</b>.
                <button type="button" class="opengame" onclick={() => postToHost({ type: "openGame" })}>Open game...</button>
            {:else}
                Point the {traHint.pathWord} path in <b>.bgforge.yml</b> (<code>mls.translation.directory</code>, e.g. <code>{traHint.dirExample}</code>)
                or add a <code>/**&nbsp;@tra&nbsp;name.{traHint.ext}&nbsp;*/</code> comment as the source file's first line.
            {/if}
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
                    <!-- Svelte Flow applies these via its `style:` directive (a real inline CSS property, not an
                         SVG presentation attribute), so `var(--vscode-*)` resolves correctly here too. maskColor
                         (the dimmed out-of-viewport overlay) needs translucency VS Code has no token for, so it
                         stays a plain black scrim - same rationale as the modal backdrop below. nodeColor is
                         charts-blue, NOT focusBorder: focusBorder is a low-saturation grey in many themes, so
                         the nodes rendered as monochrome dots; charts-blue is a theme-tuned vivid blue (the same
                         token the edges and node stroke use), restoring the coloured minimap. -->
                    <MiniMap
                        pannable
                        zoomable
                        bgColor="var(--vscode-editorWidget-background)"
                        maskColor="rgba(10, 12, 16, 0.7)"
                        nodeColor="var(--vscode-charts-blue)"
                        nodeStrokeColor="var(--vscode-charts-blue)"
                    />
                {/if}
                <!-- Legend only: the shared toolbar is now a docked header above the canvas, so this
                     top-left corner is free. Controls dock bottom-left and the MiniMap bottom-right, so
                     the legend cannot collide with either. "extern" is a WeiDU-D concept; on Fallout SSL a
                     target not in the file is a dangling reference, not a cross-file EXTERN, so relabel it. -->
                <Panel position="top-left">
                    <div class="legend">
                        <span class="lg player">player reply</span>
                        <span class="lg continue">continue</span>
                        <span class="lg exit">exit</span>
                        <span class="lg external">{renderFamily(editModel.sourceLang) === "fallout-ssl" ? "unresolved" : "extern"}</span>
                    </div>
                </Panel>
            </SvelteFlow>
        {:else}
            <div class="treewrap">
                <div class="treescroll">
                    {#if treeData.roots.length === 0}
                        <div class="treeempty">No states in this dialog file.</div>
                    {/if}
                    <Tree tree={treeData} selectedId={selected?.id} selectedChoiceId={selectedChoiceId} editingChoiceId={editingChoiceId} editingStateId={editingStateId} renamingStateId={renamingStateId} highlightedBranchKey={highlightedBranchKey} searchHits={searchHits} currentMatchKey={currentMatchKey} searchActive={searchInputFocused} collapsed={treeCollapsed} editableStateIds={editableTreeStateIds} deletableStateIds={deletableTreeStateIds} ssl={renderFamily(editModel.sourceLang) === "fallout-ssl"} onSelect={selectTreeState} onSelectReply={selectReplyInTree} onSelectBranch={selectBranchInTree} onBeginEditReply={beginEditReply} onCommitEditReply={commitEditReply} onCancelEditReply={cancelEditReply} onBeginEditState={beginEditState} onCommitEditState={commitEditState} onCancelEditState={cancelEditState} onBeginRenameState={beginRenameState} onCommitRenameState={commitRenameState} onCancelRenameState={cancelRenameState} onToggle={toggleTreeNode} onExpand={expandTreeStates} onGoToSource={goToSource} onJump={treeJump} onContext={openContext} onReplyContext={openReplyContext} onAddReply={addReplyToState} onRemoveReply={removeReplyFromState} onAddChildNode={addChildNode} onDeleteState={deleteStateFromTree} />
                </div>
                {#if ctxMenu}
                    <div class="ctxbackdrop" role="presentation" onclick={closeContext} oncontextmenu={(e) => (e.preventDefault(), closeContext())}></div>
                    <div class="ctxmenu" use:clampToViewport={[ctxMenu.x, ctxMenu.y, ctxPickTarget]} role="menu">
                        {#if ctxOwner?.derivedFrom}
                            <div class="ctxnote">Read-only ({ctxOwner.derivedFrom})</div>
                        {:else if ctxMenu.kind === "state"}
                            <button class="ctxitem" role="menuitem" disabled={!structEditable(ctxOwner)} title={structEditable(ctxOwner) ? "" : "Can't add an option here - only faithful SSL nodes (or WeiDU D states) are editable."} onclick={() => ctxAct("addReply")}>Add option</button>
                            <button class="ctxitem" role="menuitem" disabled={!structEditable(ctxOwner)} title={structEditable(ctxOwner) ? "" : "This state can't be duplicated - only faithful SSL nodes (or WeiDU D states) can be."} onclick={() => ctxAct("duplicate")}>Duplicate state</button>
                            <button class="ctxitem del" role="menuitem" disabled={!canDelete(ctxOwner)} title={canDelete(ctxOwner) ? "" : "This state can't be deleted from the graph (a dialog entry, reached by a call, or referenced from non-editable code) - edit the .ssl source."} onclick={() => ctxAct("delete")}>Delete state</button>
                        {:else if ctxReply && !ctxPickTarget}
                            <button class="ctxitem" role="menuitem" disabled={ctxReply.index === 0} title={ctxReply.index === 0 ? "Already the first option" : ""} onclick={() => replyAct("up")}>Move up</button>
                            <button class="ctxitem" role="menuitem" disabled={ctxReply.index === ctxReply.count - 1} title={ctxReply.index === ctxReply.count - 1 ? "Already the last option" : ""} onclick={() => replyAct("down")}>Move down</button>
                            <button class="ctxitem" role="menuitem" onclick={() => (ctxPickTarget = true)}>Set target...</button>
                            <button class="ctxitem del" role="menuitem" onclick={() => replyAct("remove")}>Remove option</button>
                        {:else if ctxReply}
                            <button class="ctxitem back" role="menuitem" onclick={() => (ctxPickTarget = false)}>&#8592; Set target</button>
                            <div class="ctxlist">
                                <button class="ctxitem" role="menuitem" onclick={() => setReplyTarget({ kind: "exit" })}>EXIT</button>
                                <!-- SSL convention: Combat is the Node998 target (the save ensures that procedure
                                     exists). Exit above stays the plain terminal (NMessage), always valid. -->
                                {#if isSSL}
                                    <button class="ctxitem" role="menuitem" onclick={() => setReplyTarget({ kind: "state", stateId: "Node998" })}>COMBAT</button>
                                {/if}
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
    {#if nameModal}
        <!-- Manual node-name prompt (shown only when "Auto node names" is off). Enter confirms, Escape/backdrop
             cancels; an invalid name keeps the prompt open with the reason (newStateIdError). -->
        <div class="modalback" role="presentation" onclick={cancelNameModal}></div>
        <div class="confirm" role="dialog" aria-modal="true" aria-label="Name the new node">
            <div class="confirmmsg">
                <label class="namelbl" for="new-node-name">New node name</label>
                <input
                    id="new-node-name"
                    class="nameinput"
                    use:focusSelectModal
                    bind:value={nameModal.value}
                    oninput={() => { if (nameModal) nameModal.error = ""; }}
                    onkeydown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); confirmNameModal(); }
                        else if (e.key === "Escape") { e.preventDefault(); cancelNameModal(); }
                    }}
                />
                {#if nameModal.error}<div class="nameerr" role="alert">{nameModal.error}</div>{/if}
            </div>
            <div class="confirmbtns">
                <button class="toolbtn" onclick={cancelNameModal}>Cancel</button>
                <button class="toolbtn confirmok" onclick={confirmNameModal}>Create</button>
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
        background: var(--vscode-editor-background);
        display: flex;
        flex-direction: column;
    }
    /* One tab per destination dialog file. */
    .tabbar {
        flex: 0 0 auto;
        display: flex;
        gap: 2px;
        padding: 4px 6px 0;
        background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editor-background));
        border-bottom: 1px solid var(--vscode-panel-border);
        overflow-x: auto;
    }
    .tab {
        display: flex;
        align-items: center;
        gap: 6px;
        background: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-panel-border);
        border-bottom: none;
        border-radius: 5px 5px 0 0;
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        padding: 4px 10px;
        cursor: pointer;
        white-space: nowrap;
    }
    .tab:hover {
        color: var(--vscode-foreground);
    }
    .tab.active {
        background: var(--vscode-editor-background);
        color: var(--vscode-textLink-foreground);
        border-color: var(--vscode-input-border, var(--vscode-panel-border));
    }
    .tab .tcount {
        background: var(--vscode-badge-background);
        border-radius: 8px;
        color: var(--vscode-badge-foreground);
        font-size: 9px;
        padding: 0 5px;
    }
    .tab.active .tcount {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
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
        background: var(--vscode-editor-background);
        border-left: 1px solid var(--vscode-panel-border);
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
        border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
        border-radius: 4px;
        overflow: hidden;
        /* A little extra separation from the actions that follow it on the buttons row. */
        margin-right: 6px;
        vertical-align: middle;
    }
    .viewseg button {
        background: var(--vscode-editorWidget-background);
        border: none;
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        padding: 4px 10px;
        cursor: pointer;
    }
    .viewseg button:first-child {
        border-right: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    }
    .viewseg button.active {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
    }
    /* Tree view: a scrolling outline with the toolbar pinned on top; the inspector,
       source, and issues panels float over it (same affordances as the graph). */
    .treewrap {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        background: var(--vscode-editor-background);
    }
    /* Shared docked toolbar header for BOTH graph and tree views (see the markup comment). Three stacked
       rows: feedback, buttons, hotkeys - each on its own line. Each row wraps internally on a narrow canvas
       so every control stays visible (a non-wrapping row would let .viewseg's overflow:hidden clip its own
       Graph/Tree buttons to nothing). */
    .dialogtoolbar {
        flex: 0 0 auto;
        display: flex;
        flex-direction: row;
        align-items: stretch;
        gap: 16px;
        padding: 6px 8px;
        background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editor-background));
        border-bottom: 1px solid var(--vscode-panel-border);
    }
    /* Left column: beta notice above the button row. */
    .tbleft {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    /* Beta notice sits above a separator line, with breathing room, dividing it from the buttons below. Uses
       the same panel-border token as the toolbar's other divider (the keyboard-panel border-left). */
    .tbbeta {
        padding-bottom: 6px;
        margin-bottom: 6px;
        border-bottom: 1px solid var(--vscode-panel-border);
    }
    /* One horizontal line of the toolbar (feedback / buttons); wraps internally when too narrow. */
    .tbrow {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
    }
    /* Find-bar row: text input + match count + prev/next/close, styled to sit under the button row. */
    .tbfind {
        margin-top: 4px;
    }
    .findinput {
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
        border-radius: 4px;
        color: var(--vscode-input-foreground, var(--vscode-foreground));
        font-size: 12px;
        padding: 4px 8px;
        min-width: 220px;
    }
    .findinput:focus {
        outline: none;
        border-color: var(--vscode-focusBorder);
    }
    /* Match position "3/12" (or "No matches"), fixed-ish width so the nav buttons don't jitter as it changes. */
    .findcount {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        min-width: 62px;
        text-align: center;
    }
    /* Compact square nav buttons (<, >, x) - a denser variant of .toolbtn. */
    .findnav {
        padding: 4px 8px;
        margin-right: 0;
    }
    .findnav:disabled {
        opacity: 0.45;
        cursor: default;
    }
    /* Keyboard reference docked on the right, occupying the toolbar's full height (align-items: stretch on the
       parent), vertically centered and right-aligned. */
    .tbright {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        border-left: 1px solid var(--vscode-panel-border);
        padding-left: 12px;
    }
    /* Beta notice - low-emphasis muted text on its own row. */
    .dlgbeta {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
    }
    .dlgbeta a {
        color: var(--vscode-textLink-foreground);
    }
    .dlgbeta a:hover {
        color: var(--vscode-textLink-activeForeground);
    }
    /* Tree keyboard reference: muted key -> action pairs laid out in a grid that fills 4 rows then flows into a
       new column (>=2 columns), so the panel stays short instead of one tall single-column stack. Each pair is
       a nowrap unit so a key and its label never split. Themed <kbd> chips matching the toolbar palette. */
    .keyhints {
        display: grid;
        grid-auto-flow: column;
        grid-template-rows: repeat(4, auto);
        align-content: center;
        justify-content: start;
        gap: 2px 14px;
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
    }
    .keyhints > span {
        white-space: nowrap;
    }
    .keyhints kbd {
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 9px;
        color: var(--vscode-foreground);
        background: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
        border-radius: 3px;
        padding: 0 4px;
        margin: 0 1px;
    }
    /* Unresolved-translations banner: a full-width amber notice below the toolbar, matching the
       inspector's .ronote palette. Makes a silent tra/msg-resolution failure legible and actionable. */
    .untra .opengame {
        margin-left: 0.5em;
        padding: 0 0.6em;
        font: inherit;
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
        border: 1px solid transparent;
        border-radius: 2px;
        cursor: pointer;
    }
    .untra .opengame:hover {
        background: var(--vscode-button-hoverBackground);
    }
    .untra {
        flex: 0 0 auto;
        background: var(--vscode-inputValidation-warningBackground, rgba(204, 167, 0, 0.15));
        border-bottom: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground));
        /* inputValidation-warningForeground (falls back to plain foreground), not editorWarning-foreground -
           the latter fails WCAG contrast against this warning background wash in light themes. */
        color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
        font-size: 11px;
        line-height: 1.4;
        padding: 5px 9px;
    }
    .untra b {
        color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
    }
    .untra code {
        font-family: var(--vscode-editor-font-family, monospace);
        color: var(--vscode-foreground);
        background: var(--vscode-input-background);
        border-radius: 3px;
        padding: 0 3px;
    }
    .tbsep {
        width: 1px;
        align-self: stretch;
        background: var(--vscode-panel-border);
        margin: 2px 4px;
    }
    /* "Auto node names" toggle: a checkbox label sitting beside the toolbar buttons. */
    .tbtoggle {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 12px;
        color: var(--vscode-foreground);
        cursor: pointer;
        margin-right: 4px;
        white-space: nowrap;
    }
    .tbtoggle input {
        cursor: pointer;
    }
    .treescroll {
        flex: 1;
        min-height: 0;
        overflow: auto;
    }
    .treeempty {
        color: var(--vscode-descriptionForeground);
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
        background: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
    }
    .ctxitem {
        background: none;
        border: none;
        text-align: left;
        color: var(--vscode-foreground);
        font-size: 12px;
        padding: 5px 10px;
        border-radius: 4px;
        cursor: pointer;
    }
    .ctxitem:hover:not(:disabled) {
        background: var(--vscode-list-hoverBackground);
    }
    .ctxitem:disabled {
        opacity: 0.4;
        cursor: default;
    }
    .ctxitem.del {
        color: var(--vscode-errorForeground);
    }
    /* "Set target" sub-page: a back row above a scrollable list of same-file targets. */
    .ctxitem.back {
        color: var(--vscode-descriptionForeground);
        border-bottom: 1px solid var(--vscode-panel-border);
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
        color: var(--vscode-editorWarning-foreground);
        font-size: 11px;
        padding: 5px 10px;
    }
    /* Confirm modal for a delete that would silently redirect inbound transitions to EXIT. The backdrop
       and box-shadow stay a plain black scrim - a dimming overlay/shadow reads correctly on any theme
       and VS Code exposes no dedicated token for it (the binary editor's popups leave theirs unthemed
       for the same reason). */
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
        background: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 8px;
        padding: 14px;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
        color: var(--vscode-foreground);
        font-size: 12px;
    }
    .confirmmsg {
        line-height: 1.45;
        margin-bottom: 12px;
    }
    .confirmmsg b {
        color: var(--vscode-editorWarning-foreground);
    }
    .confirmbtns {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }
    .confirmdel {
        color: var(--vscode-errorForeground);
        border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
    }
    .confirmok {
        color: var(--vscode-charts-green);
        border-color: var(--vscode-charts-green);
    }
    /* Name-prompt input + validation error (manual node naming). */
    .namelbl {
        display: block;
        margin-bottom: 6px;
        color: var(--vscode-descriptionForeground);
    }
    .nameinput {
        width: 100%;
        box-sizing: border-box;
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 12px;
        color: var(--vscode-input-foreground, var(--vscode-foreground));
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-focusBorder);
        border-radius: 4px;
        padding: 5px 7px;
    }
    .nameerr {
        margin-top: 8px;
        color: var(--vscode-errorForeground);
        line-height: 1.4;
    }
    .toolbtn {
        background: var(--vscode-button-secondaryBackground, transparent);
        border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
        border-radius: 4px;
        color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
        font-size: 12px;
        padding: 4px 10px;
        cursor: pointer;
        margin-right: 4px;
    }
    .toolbtn.active {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-color: var(--vscode-focusBorder);
    }
    .toolbtn.warn {
        color: var(--vscode-errorForeground);
        border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
    }
    /* Svelte Flow ships a light theme (white controls/minimap); theme its chrome via its own exposed
       --xy-* CSS variables to the editor palette so the controls and minimap track the active VS Code
       theme instead of rendering as blank-white (or hardcoded-dark) boxes. */
    :global(.svelte-flow__controls) {
        --xy-controls-button-background-color: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background));
        --xy-controls-button-background-color-hover: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
        --xy-controls-button-color: var(--vscode-foreground);
        --xy-controls-button-color-hover: var(--vscode-foreground);
        --xy-controls-button-border-color: var(--vscode-panel-border);
    }
    :global(.svelte-flow__minimap) {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
    }
    /* Svelte Flow's own "Svelte Flow" attribution chip (bottom-right) ships a hardcoded #999 link on a
       translucent white pill - legible-ish on a light canvas but low-contrast to invisible on a dark
       one. Theme its two exposed parts directly (the library has no --xy-attribution-* color var, only
       a background var - see @xyflow/svelte/dist/style.css). */
    :global(.svelte-flow__attribution) {
        background: var(--vscode-editorWidget-background);
    }
    :global(.svelte-flow__attribution a) {
        color: var(--vscode-descriptionForeground);
    }
    /* Larger, clearly-colored handles so a connection is obviously grabbable: drag a
       node's right-edge dot onto another node to relink that transition. The handle fill colors are
       deliberately hued (not neutral foreground/background) so a drag target reads at a glance - the
       closest documented tokens are the chart accents used for the rest of the canvas's semantic color. */
    :global(.svelte-flow__handle) {
        width: 11px;
        height: 11px;
        border: 1px solid var(--vscode-editor-background);
    }
    :global(.svelte-flow__handle-right) {
        background: var(--vscode-charts-green);
    }
    :global(.svelte-flow__handle-left) {
        background: var(--vscode-charts-blue);
    }
    /* Draggable dot on each edge (at its midpoint): grab it and drop on a node to
       relink that transition. Subtle by default, brightens on hover. */
    :global(.dlg-reconnect-anchor) {
        background: var(--vscode-charts-orange);
        border: 1px solid var(--vscode-editor-background);
        border-radius: 50%;
        opacity: 0.55;
        cursor: grab;
    }
    :global(.dlg-reconnect-anchor:hover) {
        opacity: 1;
        box-shadow: 0 0 0 2px var(--vscode-focusBorder);
    }
    .legend {
        display: flex;
        /* Wrap the key entries so a narrow canvas doesn't clip "exit"/"extern" under the rail edge -
           they are a fixed vocabulary, so they must all stay legible rather than hard-cut. */
        flex-wrap: wrap;
        gap: 4px 10px;
        background: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        padding: 3px 8px;
        font-size: 10px;
        color: var(--vscode-foreground);
    }
    .lg {
        border-left: 8px solid var(--vscode-descriptionForeground);
        padding-left: 5px;
    }
    .lg.player {
        border-color: var(--vscode-charts-green);
    }
    .lg.continue {
        border-color: var(--vscode-descriptionForeground);
        /* Continue edges render dashed in the graph; show that in the key so the style is documented. */
        border-left-style: dashed;
    }
    .lg.exit {
        border-color: var(--vscode-errorForeground);
    }
    .lg.external {
        border-color: var(--vscode-editorWarning-foreground);
    }
    .issues {
        width: 100%;
        box-sizing: border-box;
        max-height: 30vh;
        overflow: auto;
        background: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        padding: 6px 8px;
        font-size: 11px;
    }
    .issues .ok {
        color: var(--vscode-charts-green);
    }
    .issues .issue {
        color: var(--vscode-errorForeground);
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
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        padding: 8px;
        color: var(--vscode-foreground);
        font-family: monospace;
        font-size: 10px;
        line-height: 1.4;
        white-space: pre;
    }
</style>
