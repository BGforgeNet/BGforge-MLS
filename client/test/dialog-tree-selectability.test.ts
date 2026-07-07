/**
 * Regression guard: EVERY conversation-flow row that shows dialogue must be selectable.
 *
 * The tree has three parallel render paths for a state's content - flat `replies`, if/else `branches`, and
 * the recursive `block` of a `structured` node. Selection wiring (click -> select) drifts between them every
 * time a new tier is added: option rows and the state row are selectable, but the per-branch/per-block NPC
 * *line* rows were repeatedly left as inert `<span>`s with no handler. That is why a line like the else-branch
 * `Reply(200)` in a structured node (absamuel.ssl Node001) kept becoming unselectable after each refactor -
 * and there was no unit seam catching it, because selectability lives only in Tree.svelte markup.
 *
 * This test closes that gap: it SSR-renders the real Tree.svelte (compiled with esbuild-svelte, the same
 * compiler the webview build uses) and asserts every NPC line - flat, branch, and nested block - renders as a
 * selectable control, not an inert span. A revert to a non-selectable line turns it red.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import { render } from "svelte/server";
import type { Component } from "svelte";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ConversationTree } from "../src/dialog-editor/webview/conversation-tree";

// SSR-compile Tree.svelte to a temp ESM module once, then import it. esbuild-svelte compiles the .svelte
// tree (Tree + its child components) with `generate: "server"`; svelte and its runtime stay external so the
// rendered component and this test's `svelte/server` import share one installed Svelte instance.
let TreeComponent: unknown;
let tmp: string;

beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "tree-ssr-"));
    const outfile = join(tmp, "tree.mjs");
    await build({
        entryPoints: ["client/src/dialog-editor/webview/Tree.svelte"],
        outfile,
        bundle: true,
        format: "esm",
        platform: "node",
        // Bundle relative sources (Tree + Badge + LowIntChip + inspector-edit); leave svelte external so the
        // SSR output imports the same runtime this file's `render` came from.
        packages: "external",
        plugins: [esbuildSvelte({ compilerOptions: { generate: "server" } })],
        logLevel: "silent",
    });
    const mod = (await import(pathToFileURL(outfile).href)) as { default: unknown };
    TreeComponent = mod.default;
}, 60_000);

afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const noop = (): void => {};
// Every callback prop Tree destructures - passed as no-ops (SSR never invokes an event handler).
const callbacks = {
    onSelect: noop,
    onSelectReply: noop,
    onBeginEditReply: noop,
    onCommitEditReply: noop,
    onCancelEditReply: noop,
    onBeginEditState: noop,
    onCommitEditState: noop,
    onCancelEditState: noop,
    onToggle: noop,
    onExpand: noop,
    onGoToSource: noop,
    onJump: noop,
    onContext: noop,
    onReplyContext: noop,
    onAddReply: noop,
    onRemoveReply: noop,
    onAddChildNode: noop,
    onDeleteState: noop,
};

function renderTree(tree: ConversationTree, over: Record<string, unknown> = {}): string {
    // TreeComponent is compiled at runtime so it has no static prop type here; cast to a structural Svelte
    // Component whose props are an open record (the object below supplies Tree's actual props).
    const { body } = render(TreeComponent as Component<Record<string, unknown>>, {
        props: {
            tree,
            selectedId: null,
            selectedChoiceId: null,
            editingChoiceId: null,
            editingStateId: null,
            renamingStateId: null,
            collapsed: new Set<string>(),
            editableStateIds: new Set<string>(),
            deletableStateIds: new Set<string>(),
            ssl: true,
            ...callbacks,
            ...over,
        },
    });
    return body;
}

// True when `text` renders inside a <button> element (a selectable, keyboard-operable control) rather than an
// inert <span>. Scans the last <button ...> opening tag before the text and checks nothing closes it first.
function inSelectableButton(html: string, text: string): boolean {
    const idx = html.indexOf(text);
    if (idx === -1) return false;
    const before = html.slice(0, idx);
    const lastButtonOpen = before.lastIndexOf("<button");
    if (lastButtonOpen === -1) return false;
    // No intervening </button> or a new <span>/<div> that would mean the text sits outside that button.
    const between = before.slice(lastButtonOpen);
    return !between.includes("</button>");
}

describe("Tree.svelte row selectability (SSR)", () => {
    it("makes a structured node's nested else-branch NPC line selectable (absamuel Node001 / Reply(200))", () => {
        const elseLine = "So you have returned to us."; // stand-in for the resolved @200 text
        const thenLine = "Welcome back, wanderer.";
        // A structured node exactly like absamuel.ssl Node001: a top-level if/else group whose else branch's
        // opening line is the (conditional) NPC line. block[0] is a `group`, so the state row shows the "if /
        // else" fork hint and the whole block renders through convBlock - the path where the else line was inert.
        const tree: ConversationTree = {
            roots: [
                {
                    id: "Node001",
                    text: "",
                    replies: [],
                    isEntry: true,
                    textEditable: false,
                    block: [
                        {
                            kind: "group",
                            condition: "(local_var(LVAR_Herebefore) == 1)",
                            thenBlock: [
                                {
                                    kind: "line",
                                    npc: thenLine,
                                    npcHasText: true,
                                    condition: "(local_var(LVAR_Herebefore) == 1)",
                                },
                            ],
                            elseBlock: [
                                {
                                    kind: "line",
                                    npc: elseLine,
                                    npcHasText: true,
                                    condition: "not (local_var(LVAR_Herebefore) == 1)",
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        const html = renderTree(tree);
        expect(html).toContain(elseLine);
        expect(html).toContain(thenLine);
        // The regression: these nested NPC lines must be selectable controls, not inert spans.
        expect(inSelectableButton(html, elseLine)).toBe(true);
        expect(inSelectableButton(html, thenLine)).toBe(true);
    });

    it("shows the node id inline: a rename button on an editable node, a plain label when read-only", () => {
        const tree: ConversationTree = {
            roots: [
                { id: "Node001", text: "hi", replies: [], isEntry: true, textEditable: true },
                { id: "Node002", text: "yo", replies: [], isEntry: false, textEditable: false },
            ],
        };
        // Node001 editable -> its id is a rename-affordance <button class="nodeid nodeidbtn">; Node002 not in the
        // editable set -> a plain <span class="nodeid"> (no rename).
        const html = renderTree(tree, { editableStateIds: new Set(["Node001"]) });
        // Class matches tolerate Svelte's appended scoped class (e.g. "nodeid nodeidbtn svelte-xxxx").
        expect(html).toMatch(/<button[^>]*class="nodeid nodeidbtn[^"]*"[^>]*>Node001<\/button>/);
        expect(html).toMatch(/<span class="nodeid[^"]*">Node002<\/span>/);
    });

    it("renders the id as an input while that node is being renamed", () => {
        const tree: ConversationTree = {
            roots: [{ id: "Node001", text: "hi", replies: [], isEntry: true, textEditable: true }],
        };
        const html = renderTree(tree, { editableStateIds: new Set(["Node001"]), renamingStateId: "Node001" });
        expect(html).toMatch(/<input[^>]*class="nodeid nameedit[^"]*"/);
        // The rename button is replaced by the input (not both).
        expect(html).not.toMatch(/class="nodeid nodeidbtn[^"]*"/);
    });

    it("makes a bundle node's per-branch NPC lines selectable", () => {
        const ifLine = "You again.";
        const elseLine = "A stranger. Speak.";
        const tree: ConversationTree = {
            roots: [
                {
                    id: "Node010",
                    text: "",
                    replies: [],
                    isEntry: true,
                    textEditable: false,
                    branches: [
                        { kind: "if", condition: "(x)", npc: ifLine, npcHasText: true, replies: [] },
                        { kind: "else", condition: "not (x)", npc: elseLine, npcHasText: true, replies: [] },
                    ],
                },
            ],
        };
        const html = renderTree(tree);
        expect(inSelectableButton(html, ifLine)).toBe(true);
        expect(inSelectableButton(html, elseLine)).toBe(true);
    });
});

// PARITY GUARD: a branch option's STRUCTURE is read-only, but its .msg/.tra text is editable - which the
// Inspector's focused-option view allows. The tree must gate inline TEXT edit on `textEditable` ALONE, never on
// branch-ness. The bug this guards: the tree layered a coarse `branchReadonly` flag OVER `textEditable`, so a
// branch option was editable in the Inspector but not inline. If a surface re-introduces an override that
// contradicts the shared text gate, this turns red.
describe("Tree.svelte branch-option inline-edit parity (SSR)", () => {
    const branchNode = (textEditable: boolean): ConversationTree => ({
        roots: [
            {
                id: "Node001",
                text: "",
                replies: [],
                isEntry: true,
                textEditable: false,
                branches: [
                    {
                        kind: "else",
                        condition: "not (x)",
                        npc: "So you have returned.",
                        npcHasText: true,
                        replies: [
                            { id: "Node001#opt1", text: "@202", hasText: true, textEditable, target: { kind: "exit" } },
                        ],
                    },
                ],
            },
        ],
    });

    it("an editable branch option renders the inline edit input in edit mode (matches the Inspector)", () => {
        const html = renderTree(branchNode(true), { editingChoiceId: "Node001#opt1" });
        expect(html).toMatch(/<input[^>]*class="rtext rtextedit/); // editable text -> input, not a static span
    });

    it("a locked branch option stays a static span even in edit mode (text genuinely not editable)", () => {
        const html = renderTree(branchNode(false), { editingChoiceId: "Node001#opt1" });
        expect(html).not.toMatch(/rtextedit/); // not editable -> no inline input
        expect(html).toContain("@202"); // shown as static text
    });
});

// Class attribute of the element whose opening tag contains `needle` (e.g. a data-sid / data-choice attr).
// Svelte SSR folds `class:foo={cond}` into the element's `class="..."`, so the search-highlight classes land
// here when the row's key is in searchHits / equals currentMatchKey.
function classAttrOfTagWith(html: string, needle: string): string {
    const idx = html.indexOf(needle);
    if (idx === -1) return "";
    const tagStart = html.lastIndexOf("<", idx);
    const tagEnd = html.indexOf(">", idx);
    const tag = html.slice(tagStart, tagEnd);
    const m = tag.match(/class="([^"]*)"/);
    return m?.[1] ?? "";
}

describe("Tree.svelte find-bar highlight (SSR)", () => {
    // A flat entry node with one player option - covers the two most common match rows (state + option).
    const flat: ConversationTree = {
        roots: [
            {
                id: "Node001",
                text: "The guard eyes you.",
                replies: [
                    {
                        id: "Node001#opt0",
                        text: "Who are you?",
                        hasText: true,
                        textEditable: true,
                        target: { kind: "exit" },
                    },
                ],
                isEntry: true,
                textEditable: true,
            },
        ],
    };

    it("adds no highlight class when the find-bar is closed (no searchHits)", () => {
        const html = renderTree(flat);
        expect(html).not.toContain("searchhit");
        expect(html).not.toContain("searchcurrent");
    });

    it("marks a matched state row with searchhit, and the current match with searchcurrent", () => {
        const html = renderTree(flat, { searchHits: new Set(["Node001"]), currentMatchKey: "Node001" });
        const cls = classAttrOfTagWith(html, 'data-sid="Node001"');
        expect(cls).toContain("searchhit");
        expect(cls).toContain("searchcurrent");
    });

    it("marks a matched option row (not its owner state) with searchhit", () => {
        const html = renderTree(flat, { searchHits: new Set(["Node001#opt0"]), currentMatchKey: "Node001#opt0" });
        // The option row carries the highlight...
        const optCls = classAttrOfTagWith(html, 'data-choice="Node001#opt0"');
        expect(optCls).toContain("searchhit");
        expect(optCls).toContain("searchcurrent");
        // ...and its owner state row does not (a match on the option must not light up the whole node).
        const stateCls = classAttrOfTagWith(html, 'data-sid="Node001"');
        expect(stateCls).not.toContain("searchhit");
    });
});

describe("Tree.svelte inline-target label (SSR)", () => {
    // An option whose target is a first-expansion state (its node renders inline below) must STILL show a
    // target label at the end of the row - the `leaf` snippet originally had no `state` case, so these rows
    // showed no destination at all. A revert (dropping the state branch) turns this red.
    it("labels an option whose target expands inline with an arrow + the target node id", () => {
        const child: ConversationTree["roots"][number] = {
            id: "Node002",
            text: "child line",
            replies: [],
            isEntry: false,
            textEditable: true,
        };
        const tree: ConversationTree = {
            roots: [
                {
                    id: "Node001",
                    text: "hi",
                    replies: [
                        {
                            id: "Node001#opt0",
                            text: "go on",
                            hasText: true,
                            textEditable: true,
                            target: { kind: "state", node: child },
                        },
                    ],
                    isEntry: true,
                    textEditable: true,
                },
            ],
        };
        const html = renderTree(tree);
        // The muted target-label class + the destination id both render on the option row.
        expect(html).toMatch(/class="lf tgt[^"]*"[^>]*>[^<]*Node002/);
    });
});
