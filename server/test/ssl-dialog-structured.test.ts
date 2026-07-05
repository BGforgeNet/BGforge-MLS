import { describe, expect, it } from "vitest";
import { parseDialog } from "../src/dialog";
import { modelFromSSL, stateBadges } from "../../shared/dialog-model";
import type { SSLDialogGroup } from "../../shared/dialog-types";

// A node whose body mixes nested `if`s (a group inside a group), an `else` branch with its own reply line,
// an opaque side-effect, and a top-level unconditional option - the shape of Fallout2 RP's absamuel.ssl
// Node001. Such a node is neither plain- nor bundle-faithful, so before the structured tier it fell to the
// flat projection where a doubly-nested option lost its outer gate (the enclosingCondition bug). See memory
// `dialog-nested-flatten-bug-class`. This fixture reproduces that shape inline (external/ is gitignored).
const NODE001 = `
procedure Node001 begin
    if (local_var(LVAR_Herebefore) == 1) then begin
        Reply(201);
        NOption(301, Node004, 4);
        NOption(302, Node006, 4);
        if ( (global_var(GVAR_ABBEY_GRAVES) > 1) and (local_var(LVAR_Finished_Graves) == 0) ) then
            NOption(700, Node012, 4);
    end else begin
        set_global_var(GVAR_ABBEY_TULLY, 1);
        Reply(200);
        NOption(202, Node004, 4);
    end
    NOption(209, Node999, 4);
    set_local_var(LVAR_Herebefore, 1);
end
procedure Node004 begin Reply(400); NOption(401, Node999, 4); end
procedure Node006 begin Reply(500); NOption(505, Node999, 4); end
procedure Node012 begin Reply(701); NOption(703, Node999, 4); end
procedure talk_p_proc begin
    call Node001;
end
`;

describe("parseDialog (SSL) structured tier", () => {
    it("classifies a nested/interleaved node as structured, not faithful/bundle/approximate", async () => {
        const result = await parseDialog(NODE001);
        const n1 = result.nodes.find((n) => n.name === "Node001")!;
        expect(n1.structured).toBe(true);
        expect(n1.faithful).toBe(false);
        expect(n1.bundleFaithful).toBeUndefined();
        expect(n1.approximate).toBeUndefined();
        expect(n1.block).toBeDefined();
    });

    it("conjoins EVERY enclosing if into a nested option's flat condition (symptom 1)", async () => {
        const result = await parseDialog(NODE001);
        const n1 = result.nodes.find((n) => n.name === "Node001")!;
        const opt700 = n1.options.find((o) => o.msgId === 700)!;
        // The doubly-nested option carries BOTH its own inner gate AND the outer Herebefore gate.
        expect(opt700.conditional).toContain("LVAR_Herebefore");
        expect(opt700.conditional).toContain("GVAR_ABBEY_GRAVES");
        expect(opt700.conditional).toContain(" and ");
        // A sibling option gated only by the outer if keeps the single condition (outermost-first).
        const opt301 = n1.options.find((o) => o.msgId === 301)!;
        expect(opt301.conditional).toBe("(local_var(LVAR_Herebefore) == 1)");
        // The top-level option after the if/else is unconditional.
        const opt209 = n1.options.find((o) => o.msgId === 209)!;
        expect(opt209.conditional).toBeUndefined();
        // An else-branch option negates the outer condition.
        const opt202 = n1.options.find((o) => o.msgId === 202)!;
        expect(opt202.conditional).toBe("!(local_var(LVAR_Herebefore) == 1)");
    });

    it("marks a multi-level-nested option NOT condition-editable (symptom 2)", async () => {
        const result = await parseDialog(NODE001);
        const n1 = result.nodes.find((n) => n.name === "Node001")!;
        const opt700 = n1.options.find((o) => o.msgId === 700)!;
        // Its real gate is a conjunction that cannot round-trip to a single `if` wrapper, so no edit anchor.
        expect(opt700.condRange).toBeUndefined();
        expect(opt700.ifRange).toBeUndefined();
    });

    it("builds a recursive block mirroring the nesting, with the else reply line preserved (symptom 3)", async () => {
        const result = await parseDialog(NODE001);
        const n1 = result.nodes.find((n) => n.name === "Node001")!;
        const block = n1.block!;
        // Top level: the if/else group, then the unconditional option, then the opaque set_local_var.
        const group = block[0] as SSLDialogGroup;
        expect(group.kind).toBe("group");
        expect(group.condition).toContain("LVAR_Herebefore");
        expect(block[1]).toMatchObject({ kind: "choice" }); // NOption(209)
        expect(block[2]).toMatchObject({ kind: "opaque" }); // set_local_var
        // then-branch: line, two options, then a nested single-option group.
        expect(group.thenBlock[0]).toMatchObject({ kind: "line" });
        expect(group.thenBlock.some((item) => item.kind === "group")).toBe(true);
        // else-branch carries its OWN reply line (the flat projection dropped it).
        expect(group.elseBlock).toBeDefined();
        expect(group.elseBlock!.some((item) => item.kind === "line")).toBe(true);
    });

    // End-to-end through the adapter (the real producer the webview consumes): modelFromSSL must carry the
    // structured flag + block onto the DialogState and force every option's condition non-editable.
    it("modelFromSSL carries the block and marks all conditions read-only", async () => {
        const model = modelFromSSL(await parseDialog(NODE001));
        const state = model.roots[0]!.states.find((s) => s.id === "Node001")!;
        expect(state.structured).toBe(true);
        expect(state.block).toBeDefined();
        expect(state.approximate).toBeUndefined();
        // Every option is structurally read-only (a nested/composite gate cannot round-trip to one `if`).
        expect(state.choices.every((c) => c.conditionEditable === false)).toBe(true);
        // The nested option's condition is the full conjoined gate (outer AND inner), not just the inner.
        const opt700 = state.choices.find((c) => c.condition?.includes("GVAR_ABBEY_GRAVES"))!;
        expect(opt700.condition).toContain("LVAR_Herebefore");
        expect(opt700.condition).toContain("GVAR_ABBEY_GRAVES");
    });

    it("conjoins three levels of nesting (corpus dialogs nest 3-4 deep)", async () => {
        const ssl = `
procedure Node001 begin
    if (A) then begin
        if (B) then begin
            if (C) then
                NOption(1, Node002, 4);
        end
    end
end
procedure Node002 begin Reply(9); NOption(8, Node999, 4); end
procedure talk_p_proc begin call Node001; end
`;
        const result = await parseDialog(ssl);
        const n1 = result.nodes.find((n) => n.name === "Node001")!;
        expect(n1.structured).toBe(true);
        const opt = n1.options.find((o) => o.msgId === 1)!;
        // All three enclosing conditions are present, outermost-first.
        expect(opt.conditional).toBe("(A) and (B) and (C)");
        // Block nests three groups deep.
        const g1 = n1.block![0] as SSLDialogGroup;
        const g2 = g1.thenBlock[0] as SSLDialogGroup;
        const g3 = g2.thenBlock[0] as SSLDialogGroup;
        expect([g1.kind, g2.kind, g3.kind]).toEqual(["group", "group", "group"]);
        expect(g3.thenBlock[0]).toMatchObject({ kind: "choice" });
    });

    it("flags a node with control flow the block cannot model as approximate (not structured)", async () => {
        const ssl = `
procedure Node001 begin
    Reply(100);
    while (global_var(GVAR_X) < 5) do begin
        NOption(101, Node002, 4);
    end
end
procedure Node002 begin Reply(9); NOption(8, Node999, 4); end
procedure talk_p_proc begin call Node001; end
`;
        const result = await parseDialog(ssl);
        const n1 = result.nodes.find((n) => n.name === "Node001")!;
        expect(n1.approximate).toBe(true);
        expect(n1.structured).toBeUndefined();
        expect(n1.bundleFaithful).toBeUndefined();
        expect(n1.block).toBeUndefined();

        // The lossy approximation must be surfaced as a loud "approximate" badge (decision 3: not silent).
        const state = modelFromSSL(result).roots[0]!.states.find((s) => s.id === "Node001")!;
        expect(state.approximate).toBe(true);
        expect(stateBadges(state)).toContain("approximate");
    });
});
