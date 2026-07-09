import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTSSLSource } from "../src/tssl/dialog-source";
import { modelFromSSL } from "../../shared/dialog-model";

// The syntax-error degrade logs through the LSP connection, which unit tests never initialize.
vi.mock("../src/logger", () => ({ conlog: vi.fn() }));

const sample = (name: string): string =>
    readFileSync(fileURLToPath(new URL(`tssl/samples/${name}`, import.meta.url)), "utf8");

describe("parseTSSLSource - flat dialog", () => {
    const flat = sample("flat.tssl");

    it("finds both nodes, each with a procRange into the TSSL source", () => {
        const data = parseTSSLSource(flat);
        expect(data.nodes.map((n) => n.name).sort()).toEqual(["Node001", "Node002"]);
        const n1 = data.nodes.find((n) => n.name === "Node001")!;
        // procRange must slice back to the TSSL source (not generated SSL) - the whole point of source parsing.
        expect(flat.slice(n1.procRange!.start, n1.procRange!.end)).toContain("function Node001");
    });

    it("a flat node of dialog calls is faithful, with its option target", () => {
        const n1 = parseTSSLSource(flat).nodes.find((n) => n.name === "Node001")!;
        expect(n1.faithful).toBe(true);
        expect(n1.replies.map((r) => r.msgId)).toEqual([100]);
        expect(n1.options.map((o) => o.target)).toEqual(["Node002"]);
        expect(n1.options.map((o) => o.msgId)).toEqual([101]);
    });

    it("collects the entry point from talk_p_proc", () => {
        expect(parseTSSLSource(flat).entryPoints).toContain("Node001");
    });
});

describe("parseTSSLSource - tiers", () => {
    // SSL semantics (mirrored): a single-level `if` with no `else` is faithful; nesting an `if` is structured.
    it("a single-level if (no else) is still faithful", () => {
        const n1 = parseTSSLSource(sample("conditional.tssl")).nodes.find((n) => n.name === "Node001")!;
        expect(n1.faithful).toBe(true);
    });

    it("records the enclosing-if condition span on a conditional option (edit-ready)", () => {
        const src = sample("conditional.tssl");
        const opt = parseTSSLSource(src).nodes.find((n) => n.name === "Node001")!.options[0]!;
        expect(opt.conditional).toContain("GVAR_X");
        expect(src.slice(opt.condRange!.start, opt.condRange!.end)).toContain("GVAR_X");
        expect(opt.ifPure).toBe(true); // the then-block holds this option alone -> condition-editable
    });

    it("a nested if is structured (read-only, faithfully displayed)", () => {
        const n1 = parseTSSLSource(sample("nested.tssl")).nodes.find((n) => n.name === "Node001")!;
        expect(n1.faithful).toBe(false);
        expect(n1.structured).toBe(true);
    });

    it("a doubly-nested option conjoins EVERY enclosing if into `conditional` (not just the innermost)", () => {
        // The old single-level parser returned undefined for a 2+-level gate, so a gated option displayed as
        // unconditional (dialog-nested-flatten-bug-class, symptom 1). Parity with the native SSL parser.
        const opt = parseTSSLSource(sample("nested.tssl")).nodes.find((n) => n.name === "Node001")!.options[0]!;
        expect(opt.conditional).toBe("global_var(GVAR_X) == 1 and global_var(GVAR_Y) == 1");
        // A multi-level gate cannot round-trip to one `if` wrapper, so it carries no condition-edit anchor.
        expect(opt.condRange).toBeUndefined();
        expect(opt.ifPure).toBeUndefined();
    });
});

describe("parseTSSLSource - bundle tier (SSL parity)", () => {
    const src = sample("bundle.tssl");
    const node = () => parseTSSLSource(src).nodes.find((n) => n.name === "Node001")!;

    it("classifies a single-level if/else of dialog calls as bundleFaithful (editable), not read-only structured", () => {
        const n = node();
        expect(n.faithful).toBe(false);
        expect(n.bundleFaithful).toBe(true);
        expect(n.structured).toBeUndefined();
        expect(n.approximate).toBeUndefined();
    });

    it("builds an if branch and an else branch, indexing the flat reply/option arrays by source order", () => {
        const n = node();
        expect(n.branches?.map((b) => b.kind)).toEqual(["if", "else"]);
        const ifBranch = n.branches!.find((b) => b.kind === "if")!;
        const elseBranch = n.branches!.find((b) => b.kind === "else")!;
        // if-branch: Reply(100) -> replies[0], NOption -> options[0]. else-branch: Reply(200) -> replies[1],
        // NMessage(301) -> options[1]. Indices advance in the source-order preorder the flat walk uses.
        expect(ifBranch.replyIndices).toEqual([0]);
        expect(ifBranch.optionIndices).toEqual([0]);
        expect(elseBranch.replyIndices).toEqual([1]);
        expect(elseBranch.optionIndices).toEqual([1]);
        expect(n.options[0]!.target).toBe("Node002");
        expect(n.options[1]!.msgId).toBe(301);
    });

    it("preserves a non-dialog side-effect statement in a branch as opaque byte-exact text", () => {
        const ifBranch = node().branches!.find((b) => b.kind === "if")!;
        expect(ifBranch.opaque.map((o) => o.text)).toEqual(["set_local_var(LVAR_SEEN, 1);"]);
    });

    it("records the if-branch condition span (edit-ready) and the else-clause span", () => {
        const n = node();
        const ifBranch = n.branches!.find((b) => b.kind === "if")!;
        expect(src.slice(ifBranch.conditionRange!.start, ifBranch.conditionRange!.end)).toContain("GVAR_X");
        const elseBranch = n.branches!.find((b) => b.kind === "else")!;
        expect(src.slice(elseBranch.elseClauseRange!.start, elseBranch.elseClauseRange!.end)).toMatch(/^else/);
    });
});

describe("parseTSSLSource - assignment in structured tier (SSL parity)", () => {
    const src = sample("assign.tssl");
    const node = () => parseTSSLSource(src).nodes.find((n) => n.name === "Node001")!;

    it("keeps a node whose branch holds an assignment at the structured tier, not lossy approximate", () => {
        const n = node();
        expect(n.approximate).toBeUndefined();
        expect(n.structured).toBe(true);
    });

    it("preserves the assignment as an opaque block item, byte-exact", () => {
        const group = node().block!.find((i) => i.kind === "group") as { thenBlock: { kind: string; text?: string }[] };
        const opaque = group.thenBlock.find((i) => i.kind === "opaque")!;
        expect(opaque.text).toBe("game_global_var = 5;");
    });
});

describe("parseTSSLSource - node inclusion (SSL parity)", () => {
    const data = () => parseTSSLSource(sample("hook.tssl"));

    it("excludes a *_p_proc engine hook even when it contains a dialog call", () => {
        expect(data().nodes.map((n) => n.name)).not.toContain("look_at_p_proc");
    });

    it("keeps a reachable node and an unwired orphan dialog node", () => {
        const names = data()
            .nodes.map((n) => n.name)
            .sort();
        expect(names).toEqual(["Node001", "Node099"]);
    });
});

describe("parseTSSLSource - conditional scoping + block (SSL parity)", () => {
    const scoped = sample("scoped.tssl");
    const node = () => parseTSSLSource(scoped).nodes.find((n) => n.name === "Node001")!;

    it("scopes an option's condition to its own state, dropping the state-level gate", () => {
        const opt = node().options.find((o) => o.target === "Node002")!;
        // The outer `if` also gates the first Reply (it becomes the state trigger), so scopedConditional drops it.
        expect(opt.conditional).toBe("global_var(GVAR_X) == 1 and global_var(GVAR_Y) == 1");
        expect(opt.scopedConditional).toBe("global_var(GVAR_Y) == 1");
    });

    it("negates the else branch and conditions a terminal message (Message-branch parity)", () => {
        const msg = node().options.find((o) => o.type === "NMessage")!;
        expect(msg.msgId).toBe(301);
        expect(msg.conditional).toBe("global_var(GVAR_X) == 1 and not global_var(GVAR_Y) == 1");
        expect(msg.scopedConditional).toBe("not global_var(GVAR_Y) == 1");
    });

    it("records a per-site call transition (so the block can index it)", () => {
        const n = node();
        expect(n.callTransitions?.map((t) => t.name)).toEqual(["Node003"]);
        expect(scoped.slice(n.callTransitions![0]!.targetRange!.start, n.callTransitions![0]!.targetRange!.end)).toBe(
            "Node003",
        );
    });

    it("builds a recursive block mirroring the nested if/else, indexing the flat arrays", () => {
        const n = node();
        expect(n.structured).toBe(true);
        // One top-level group (the outer if); its then-block holds the Reply line, the inner group, and the call.
        expect(n.block).toEqual([
            {
                kind: "group",
                condition: "global_var(GVAR_X) == 1",
                conditionRange: expect.any(Object),
                thenBlock: [
                    { kind: "line", replyIndex: 0 },
                    {
                        kind: "group",
                        condition: "global_var(GVAR_Y) == 1",
                        conditionRange: expect.any(Object),
                        thenBlock: [{ kind: "choice", optionIndex: 0 }],
                        elseBlock: [{ kind: "choice", optionIndex: 1 }],
                    },
                    { kind: "transition", transitionIndex: 0 },
                ],
            },
        ]);
        // The indices resolve: options[0] is the NOption, options[1] the NMessage, replies[0] the Reply.
        expect(n.options[0]!.target).toBe("Node002");
        expect(n.options[1]!.msgId).toBe(301);
        expect(n.replies[0]!.msgId).toBe(100);
    });
});

describe("TSSL structured node through the adapter (consumer path)", () => {
    it("modelFromSSL resolves a structured TSSL node's block that the webview renders", () => {
        // The webview reads DialogState.block, not the parser's raw output - guard the whole parser -> adapter
        // path so the parser's field names (block/callTransitions/scopedConditional) match what the adapter reads.
        const state = modelFromSSL(parseTSSLSource(sample("scoped.tssl")))
            .roots.flatMap((r) => r.states)
            .find((s) => s.id === "Node001")!;
        expect(state.structured).toBe(true);
        // Outer group (GVAR_X) whose then-block holds the Reply line, the inner if/else group, and the transition.
        expect(state.block?.[0]?.kind).toBe("group");
        const outer = state.block![0] as { kind: "group"; condition: string; thenBlock: { kind: string }[] };
        expect(outer.condition).toContain("GVAR_X");
        expect(outer.thenBlock.map((i) => i.kind)).toEqual(["line", "group", "choice"]);
        // The option choice carries its state-scoped condition (outer state gate dropped).
        const opt = state.choices.find((c) => c.target.kind === "state")!;
        expect(opt.condition).toBe("global_var(GVAR_Y) == 1");
    });
});

describe("parseTSSLSource - out-of-band starts (SSL parity)", () => {
    it("captures a force_dialog_start target reached from outside talk_p_proc", () => {
        const src = sample("outofband.tssl");
        const data = parseTSSLSource(src);
        expect(data.outOfBandCalls?.map((c) => c.name)).toEqual(["Node001"]);
        const span = data.outOfBandCalls![0]!.targetRange;
        expect(src.slice(span.start, span.end)).toBe("Node001");
        // The out-of-band target is also an entry point (the conversation can start there).
        expect(data.entryPoints).toContain("Node001");
    });
});

describe("parseTSSLSource - malformed input", () => {
    it("degrades to the empty model on a syntax error instead of building anchors from a misnested parse", () => {
        // Unclosed brace: TS error recovery swallows the following function into Node001's body, so a
        // best-effort parse would re-parent Node002 and yield splice anchors the write-back cannot trust.
        const src = `function Node001() { Reply(100);
function Node002() { Reply(200); }
`;
        expect(parseTSSLSource(src)).toEqual({ nodes: [], entryPoints: [] });
    });

    it("still parses clean input after the guard (the guard stays silent on valid source)", () => {
        const data = parseTSSLSource(sample("flat.tssl"));
        expect(data.nodes.length).toBeGreaterThan(0);
    });
});

describe("parseTSSLSource - side-effect honesty badge (SSL parity)", () => {
    const SIDE_EFFECT_FNS: ReadonlySet<string> = new Set(["set_global_var", "give_xp"]);

    it("records source-ordered, deduplicated side-effect builtins on the node", () => {
        const src = `function Node001() {
    Reply(100);
    set_global_var("GVAR_DONE", 1);
    give_xp(500);
    set_global_var("GVAR_AGAIN", 2);
    NOption(101, Node002);
}
function Node002() {
    Reply(200);
}
function talk_p_proc() {
    Node001();
}
`;
        const n1 = parseTSSLSource(src, SIDE_EFFECT_FNS).nodes.find((n) => n.name === "Node001")!;
        expect(n1.sideEffects).toEqual(["set_global_var", "give_xp"]);
    });

    it("leaves sideEffects absent for calls outside the set, and when no set is passed", () => {
        const src = `function Node001() {
    Reply(100);
    some_reader(1);
}
function talk_p_proc() {
    Node001();
}
`;
        expect(parseTSSLSource(src, SIDE_EFFECT_FNS).nodes[0]!.sideEffects).toBeUndefined();
        expect(parseTSSLSource(src).nodes[0]!.sideEffects).toBeUndefined();
    });
});
