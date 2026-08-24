import { describe, expect, it } from "vitest";
import {
    conditionLockReason,
    isPendingChoice,
    isPendingState,
    msgRef,
    npcLineAuthorable,
    optionRemoveLockReason,
    stateReadOnlyReason,
    structuralLockReason,
    sayLineEditability,
    textEditability,
    textFieldLocked,
    textLockReason,
    writeText,
} from "../src/dialog-editor/webview/inspector-edit";
import { modelFromSSL, type DialogChoice, type DialogState } from "../../shared/dialog-model";
import type { SSLDialogData } from "../../shared/dialog-types";

describe("writeText (single-line normalization)", () => {
    it("replaces baked newlines with a space so the .msg/.tra line stays single-line (both @N and literal paths)", () => {
        // BUG D: the inspector NPC field is a textarea, so Enter (or a multi-line paste) put a newline into the
        // value that the write-through persisted - the .msg/.tra line is single-line by format, so the write
        // must fold newlines out. Each CR/LF/CRLF becomes ONE space (never a line break in the stored value).
        const messages: Record<string, string> = { "104": "old" };
        writeText({ text: "@104" }, messages, "line one\nline two");
        expect(messages["104"]).toBe("line one line two");
        const literal = { text: "seed" };
        writeText(literal, undefined, "a\r\nb\rc");
        expect(literal.text).toBe("a b c");
    });

    it("preserves other whitespace (writeText runs on every keystroke; trimming would fight live typing)", () => {
        const literal = { text: "seed" };
        writeText(literal, undefined, "hello ");
        expect(literal.text).toBe("hello "); // a trailing space the user is mid-typing survives
    });
});

describe("sayLineEditability (a multisay continuation line)", () => {
    const messages = { "20": "Second line." };
    it("editable for a resolved @N, locked for an unresolved one (with a reason), never pending", () => {
        expect(sayLineEditability({ text: "@20", messages, ssl: false, textRO: false }).editable).toBe(true);
        const locked = sayLineEditability({ text: "@99", messages, ssl: false, textRO: false });
        expect(locked.editable).toBe(false);
        expect(locked.reason).toContain("@99");
    });
    it("locks every line of a read-only (derived) state", () => {
        const r = sayLineEditability({ text: "@20", messages, ssl: false, textRO: true, derivedFrom: "CHAIN" });
        expect(r.editable).toBe(false);
        expect(r.reason).toContain("CHAIN");
    });
});

describe("msgRef", () => {
    it("parses a bare @N line to its numeric id", () => {
        expect(msgRef("@200")).toBe("200");
        expect(msgRef("  @201  ")).toBe("201"); // surrounding whitespace tolerated
    });
    it("returns null for literal or non-@N text", () => {
        expect(msgRef("The town is quiet")).toBeNull();
        expect(msgRef("@abc")).toBeNull();
        expect(msgRef(undefined)).toBeNull();
        expect(msgRef("")).toBeNull();
    });
});

describe("textFieldLocked", () => {
    const messages = { "200": "The town is quiet these days.", "201": "" };

    it("locks any field of a read-only state", () => {
        expect(textFieldLocked({ text: "@200", messages, ssl: true, textRO: true })).toBe(true);
        expect(textFieldLocked({ text: "@200", messages, ssl: false, textRO: true })).toBe(true);
    });

    it("D: a literal text field is editable (D persists literals via the .d splice)", () => {
        expect(textFieldLocked({ text: "Some literal line", messages, ssl: false, textRO: false })).toBe(false);
        expect(textFieldLocked({ text: "@200", messages, ssl: false, textRO: false })).toBe(false);
    });

    it("D: an @N field whose .tra entry did NOT load is locked (BUG E: would silently drop the edit)", () => {
        // The bug: D short-circuited to editable, but an unresolved @tra ref has no entry to write - the edit
        // updated only the in-memory value, the tab read "saved", and nothing reached disk. Lock it like SSL.
        expect(textFieldLocked({ text: "@999", messages, ssl: false, textRO: false })).toBe(true);
        expect(textFieldLocked({ text: "@200", messages: {}, ssl: false, textRO: false })).toBe(true);
        expect(textFieldLocked({ text: "@200", messages: undefined, ssl: false, textRO: false })).toBe(true);
    });

    it("SSL: an @N field whose .msg entry resolved is editable", () => {
        expect(textFieldLocked({ text: "@200", messages, ssl: true, textRO: false })).toBe(false);
        // An empty-string entry is still a resolved entry - editable.
        expect(textFieldLocked({ text: "@201", messages, ssl: true, textRO: false })).toBe(false);
    });

    it("SSL: an @N field whose .msg entry did NOT load is locked (would silently lose the edit)", () => {
        // The bug: ref is non-null so the old guard left it editable, but there is no .msg line to write.
        expect(textFieldLocked({ text: "@999", messages, ssl: true, textRO: false })).toBe(true);
        expect(textFieldLocked({ text: "@200", messages: undefined, ssl: true, textRO: false })).toBe(true);
        expect(textFieldLocked({ text: "@200", messages: {}, ssl: true, textRO: false })).toBe(true);
    });

    it("SSL: a literal (non-@N) field is locked - SSL save only writes resolvable .msg entries", () => {
        expect(textFieldLocked({ text: "raw literal", messages, ssl: true, textRO: false })).toBe(true);
    });

    it("SSL: a PENDING-NEW field is editable so the user can type its initial text (allocated an @id at save)", () => {
        // A just-added option/node starts with empty (or literal) text and no .msg entry; locking it would
        // make add-option / add-node unusable for SSL. textRO still wins.
        expect(textFieldLocked({ text: "", messages, ssl: true, textRO: false, isNew: true })).toBe(false);
        expect(textFieldLocked({ text: "typed literal", messages, ssl: true, textRO: false, isNew: true })).toBe(false);
        expect(textFieldLocked({ text: "", messages, ssl: true, textRO: true, isNew: true })).toBe(true);
    });

    it("isNew defaults to false - an existing unresolvable @N stays locked", () => {
        expect(textFieldLocked({ text: "@999", messages, ssl: true, textRO: false })).toBe(true);
    });
});

describe("isPendingChoice", () => {
    it("a choice with no source span of any kind is pending-new", () => {
        expect(isPendingChoice({ id: "x", text: "", target: { kind: "exit" } })).toBe(true);
    });
    it("an existing option (callRange or stmtRange) is not pending", () => {
        expect(
            isPendingChoice({ id: "x", text: "@1", target: { kind: "exit" }, callRange: { start: 0, end: 1 } }),
        ).toBe(false);
        expect(
            isPendingChoice({ id: "x", text: "@1", target: { kind: "exit" }, stmtRange: { start: 0, end: 1 } }),
        ).toBe(false);
    });
    it("a call transition (callSites) is not pending", () => {
        expect(
            isPendingChoice({
                id: "x",
                target: { kind: "state", stateId: "N" },
                callSites: [{ stmtRange: { start: 0, end: 1 }, topLevel: true }],
            }),
        ).toBe(false);
    });
    it("an existing WeiDU D option (sourceRange, no SSL spans) is not pending", () => {
        // Without the sourceRange gate this reads as pending (D never sets the SSL span fields), which is a
        // latent trap for any consumer other than the D-short-circuiting textFieldLocked.
        expect(
            isPendingChoice({ id: "x", text: "@1", target: { kind: "exit" }, sourceRange: { start: 0, end: 1 } }),
        ).toBe(false);
    });
});

describe("isPendingState", () => {
    it("a state with no source span is pending-new; with a procRange (SSL) it is not", () => {
        expect(isPendingState({ id: "N", text: "", choices: [] })).toBe(true);
        expect(isPendingState({ id: "N", text: "", choices: [], procRange: { start: 0, end: 1 } })).toBe(false);
    });
    it("an existing WeiDU D state (sourceRange, no procRange) is not pending", () => {
        expect(isPendingState({ id: "N", text: "", choices: [], sourceRange: { start: 0, end: 1 } })).toBe(false);
    });
});

describe("npcLineAuthorable", () => {
    it("a pending-new node (no source span) is authorable", () => {
        expect(npcLineAuthorable({ id: "N", text: "", choices: [] })).toBe(true);
    });
    it("a faithful reply-less node adopted from source (procRange + replyless) stays authorable after the pending window closes", () => {
        // The +State regression: after the splice the webview adopts the re-parse, so the node has a procRange
        // and is no longer pending - but its Reply is still empty and the save path will allocate it, so the
        // NPC line must stay editable. `replyless` survives the user typing the first line (text becomes a literal).
        const adopted: DialogState = {
            id: "N",
            text: "",
            choices: [],
            procRange: { start: 0, end: 9 },
            replyless: true,
        };
        expect(isPendingState(adopted)).toBe(false); // no longer pending post-adopt
        expect(npcLineAuthorable(adopted)).toBe(true);
        // Still authorable once the user has typed a not-yet-saved literal into it.
        expect(npcLineAuthorable({ ...adopted, text: "Hello there." })).toBe(true);
    });
    it("a node whose reply already resolves to @N is NOT authorable (edited via the resolvable-@N path, not allocation)", () => {
        expect(npcLineAuthorable({ id: "N", text: "@200", choices: [], procRange: { start: 0, end: 9 } })).toBe(false);
    });
    it("a non-replyless literal node is NOT authorable (a genuine literal has nowhere to write on SSL save)", () => {
        expect(npcLineAuthorable({ id: "N", text: "raw literal", choices: [], procRange: { start: 0, end: 9 } })).toBe(
            false,
        );
    });
});

describe("replyless projection + gate (the +State NPC-line regression)", () => {
    // An ADOPTED node (post-splice re-parse) carries a `procRange`, so it is not pending - isolating the
    // `replyless` arm of the gate from the pending-new arm.
    const faithlessNode = (over: Partial<SSLDialogData["nodes"][number]>): SSLDialogData["nodes"][number] => ({
        name: "Node001",
        line: 1,
        callTargets: [],
        replies: [],
        options: [],
        procRange: { start: 0, end: 30 },
        ...over,
    });

    const anchor = { offset: 42, indent: "    " };

    it("modelFromSSL marks a faithful reply-less node with a splice anchor `replyless`, so its empty NPC line is editable", () => {
        const model = modelFromSSL({
            entryPoints: ["Node001"],
            nodes: [faithlessNode({ faithful: true, insertAnchor: anchor })],
        });
        const state = model.roots[0]!.states[0]!;
        expect(state.text).toBe(""); // reply-less -> empty NPC line
        expect(state.replyless).toBe(true);
        // The composed inspector gate: an empty faithful reply-less SSL line is NOT locked.
        expect(
            textFieldLocked({
                text: state.text,
                messages: model.messages,
                ssl: true,
                textRO: false,
                isNew: npcLineAuthorable(state),
            }),
        ).toBe(false);
    });

    it("a node WITH a reply is not `replyless` (its @N line uses the resolvable path)", () => {
        const model = modelFromSSL({
            entryPoints: ["Node001"],
            nodes: [faithlessNode({ faithful: true, insertAnchor: anchor, replies: [{ msgId: 200, line: 2 }] })],
        });
        expect(model.roots[0]!.states[0]!.replyless).toBeUndefined();
    });

    it("a NON-faithful reply-less node is not `replyless` (the writer won't splice a reply into it)", () => {
        const model = modelFromSSL({
            entryPoints: ["Node001"],
            nodes: [faithlessNode({ faithful: false, insertAnchor: anchor })],
        });
        expect(model.roots[0]!.states[0]!.replyless).toBeUndefined();
    });

    it("a faithful reply-less node with NO node-level insertAnchor (the TSSL shape) is not `replyless` - replyOps can't splice, so the line stays locked", () => {
        const model = modelFromSSL({ entryPoints: ["Node001"], nodes: [faithlessNode({ faithful: true })] });
        const state = model.roots[0]!.states[0]!;
        expect(state.replyless).toBeUndefined();
        expect(
            textFieldLocked({
                text: state.text,
                messages: model.messages,
                ssl: true,
                textRO: false,
                isNew: npcLineAuthorable(state),
            }),
        ).toBe(true);
    });
});

describe("textEditability (unified text gate - one decision both views consume)", () => {
    const messages = { "200": "The town is quiet." };
    const st = (over: Partial<DialogState> = {}): DialogState => ({ id: "N", text: "@200", choices: [], ...over });
    const ch = (over: Partial<DialogChoice> = {}): DialogChoice => ({ id: "c0", target: { kind: "exit" }, ...over });

    it("returns both the lock AND the reason from one call, so the two views can't assemble it differently", () => {
        // Editable -> empty reason.
        expect(
            textEditability({
                state: st({ procRange: { start: 0, end: 9 } }),
                choice: null,
                messages,
                ssl: true,
                textRO: false,
            }),
        ).toEqual({
            editable: true,
            reason: "",
        });
        // Locked -> a concrete reason string.
        const literal = textEditability({
            state: st({ text: "raw", procRange: { start: 0, end: 9 } }),
            choice: null,
            messages,
            ssl: true,
            textRO: false,
        });
        expect(literal.editable).toBe(false);
        expect(literal.reason).toMatch(/no plain @N/);
    });

    // A DLG holds a number pointing into the game's string table, so there is nowhere to put typed prose. It
    // used to read as editable whenever the string resolved, and the host then dropped the edit in silence.
    it("locks a compiled dialog's line even when its string resolved", () => {
        const gate = textEditability({ state: st(), choice: null, messages, ssl: false, textRO: false, dlg: true });
        expect(gate.editable).toBe(false);
        expect(gate.reason).toMatch(/Change string/);
    });

    it("locks a compiled dialog's reply text for the same reason", () => {
        const gate = textEditability({
            state: st(),
            choice: ch({ text: "@200" }),
            messages,
            ssl: false,
            textRO: false,
            dlg: true,
        });
        expect(gate.editable).toBe(false);
        expect(gate.reason).toMatch(/Change string/);
    });

    it("does not point at a button a state from another dialog does not have", () => {
        // The tree holds the dialogs this one hands off to. Their lines are locked for a different reason -
        // the editor writes one file - and telling the reader to press "Change string..." is a dead end.
        const gate = textEditability({
            state: st(),
            choice: null,
            messages,
            ssl: false,
            textRO: false,
            dlg: true,
            foreign: true,
        });
        expect(gate.editable).toBe(false);
        expect(gate.reason).not.toMatch(/Change string/);
        expect(gate.reason).toMatch(/another dialog/i);
    });

    it("leaves every other format alone", () => {
        expect(
            textEditability({ state: st(), choice: null, messages, ssl: false, textRO: false, dlg: false }).editable,
        ).toBe(true);
    });

    it("NPC line of a faithful reply-less adopted SSL node is editable (the +State regression, decided in one place)", () => {
        const state = st({ text: "", procRange: { start: 0, end: 9 }, replyless: true });
        expect(textEditability({ state, choice: null, messages, ssl: true, textRO: false })).toEqual({
            editable: true,
            reason: "",
        });
    });

    it("NPC line of a read-only (derived) state is locked with the derived-construct reason", () => {
        const r = textEditability({
            state: st({ derivedFrom: "CHAIN" }),
            choice: null,
            messages,
            ssl: true,
            textRO: true,
        });
        expect(r.editable).toBe(false);
        expect(r.reason).toContain("CHAIN");
    });

    it("option text: a pending choice is editable; an unresolved @N is locked", () => {
        expect(textEditability({ state: st(), choice: ch({ text: "" }), messages, ssl: true, textRO: false })).toEqual({
            editable: true,
            reason: "",
        });
        const unresolved = textEditability({
            state: st(),
            choice: ch({ text: "@999", callRange: { start: 0, end: 1 } }),
            messages,
            ssl: true,
            textRO: false,
        });
        expect(unresolved.editable).toBe(false);
        expect(unresolved.reason).toContain("@999");
    });

    it("D-family literal text is editable (persisted via the .d splice) when the caller's textRO is false", () => {
        expect(
            textEditability({
                state: st({ text: "a literal D line" }),
                choice: null,
                messages,
                ssl: false,
                textRO: false,
            }),
        ).toEqual({
            editable: true,
            reason: "",
        });
    });

    it("D-family unresolved @N is locked with a .tra reason (BUG E: no silent 'saved' on a dropped write)", () => {
        const r = textEditability({
            state: st({ text: "@999", sourceRange: { start: 0, end: 9 } }),
            choice: null,
            messages,
            ssl: false,
            textRO: false,
        });
        expect(r.editable).toBe(false);
        expect(r.reason).toContain("@999");
        expect(r.reason).toContain(".tra");
    });

    it("passes the caller's textRO straight through (the tree can lock text the inspector leaves open)", () => {
        // Same D-family literal, but the caller (e.g. the tree, for a non-field-editable state) says textRO -> locked.
        const r = textEditability({
            state: st({ text: "a literal D line" }),
            choice: null,
            messages,
            ssl: false,
            textRO: true,
        });
        expect(r.editable).toBe(false);
        expect(r.reason).toBe("This dialog is open read-only.");
    });

    it("agrees with the underlying primitives (it composes them, not a second derivation)", () => {
        const state = st({ text: "", procRange: { start: 0, end: 9 }, replyless: true });
        const unified = textEditability({ state, choice: null, messages, ssl: true, textRO: false });
        const isNew = npcLineAuthorable(state);
        expect(unified.editable).toBe(
            !textFieldLocked({ text: state.text, messages, ssl: true, textRO: false, isNew }),
        );
        expect(unified.reason).toBe(textLockReason({ text: state.text, messages, ssl: true, textRO: false, isNew }));
    });
});

describe("disabled-reason helpers", () => {
    const st = (over: Partial<DialogState> = {}): DialogState => ({
        id: "Node001",
        text: "@200",
        choices: [],
        ...over,
    });
    const ch = (over: Partial<DialogChoice> = {}): DialogChoice => ({ id: "c0", target: { kind: "exit" }, ...over });
    const messages = { "200": "The town is quiet." };

    it("stateReadOnlyReason names the derived construct, else says read-only", () => {
        expect(stateReadOnlyReason("CHAIN")).toContain("CHAIN");
        expect(stateReadOnlyReason("CHAIN")).toMatch(/CHAIN source/);
        expect(stateReadOnlyReason(undefined)).toBe("This dialog is open read-only.");
    });

    it("structuralLockReason distinguishes derived, approximate, structured, and generic SSL nodes", () => {
        expect(structuralLockReason(st({ derivedFrom: "INTERJECT" }), true, false)).toContain("INTERJECT");
        expect(structuralLockReason(st({ approximate: true }), true, false)).toMatch(/loop or switch/);
        // The structured tier covers a nested if/else AND a preserved non-dialog statement (e.g. a var set), so
        // the reason must not claim if/else EXCLUSIVELY (it misdescribed a trailing-side-effect node before).
        expect(structuralLockReason(st({ structured: true }), true, false)).toMatch(/non-dialog statement/);
        expect(structuralLockReason(st(), true, false)).toMatch(/isn't simple enough/);
        // Non-SSL (D): editable file -> no reason; view-only -> read-only.
        expect(structuralLockReason(st(), false, true)).toBe("");
        expect(structuralLockReason(st(), false, false)).toBe("This dialog is open read-only.");
        // Each reason points the user at the source generically (never a specific ext - a .tssl has no .ssl).
        const r = structuralLockReason(st({ structured: true }), true, false);
        expect(r).toMatch(/edit the source file/);
        expect(r).not.toMatch(/\.ssl/);
    });

    it("textLockReason explains an unresolved @N vs a literal, and is empty when editable", () => {
        // Editable resolvable @N -> no reason.
        expect(textLockReason({ text: "@200", messages, ssl: true, textRO: false })).toBe("");
        // Unresolved @N -> names the id and points at translation.directory.
        const unresolved = textLockReason({ text: "@999", messages, ssl: true, textRO: false });
        expect(unresolved).toContain("@999");
        expect(unresolved).toMatch(/translation\.directory/);
        // Literal (no @N) -> says there's no .msg entry, pointing at the source file generically (no .ssl).
        const literal = textLockReason({ text: "raw", messages, ssl: true, textRO: false });
        expect(literal).toMatch(/no plain @N.*source file/s);
        expect(literal).not.toMatch(/\.ssl/);
        // Read-only derived state -> derived wording.
        expect(textLockReason({ text: "@200", messages, ssl: true, textRO: true, derivedFrom: "EXTEND" })).toContain(
            "EXTEND",
        );
    });

    it("conditionLockReason distinguishes a read-only structure from a shared condition", () => {
        expect(conditionLockReason(st({ structured: true }), ch({ conditionEditable: false }), true, false)).toMatch(
            /can't round-trip/,
        );
        const shared = conditionLockReason(st(), ch({ conditionEditable: false }), true, false);
        expect(shared).toMatch(/gates more than just this option/);
        expect(shared).toMatch(/source file/);
        expect(shared).not.toMatch(/\.ssl/);
        // Editable condition -> no reason.
        expect(conditionLockReason(st(), ch({ conditionEditable: true }), true, false)).toBe("");
    });

    it("optionRemoveLockReason points at the source file generically", () => {
        const r = optionRemoveLockReason();
        expect(r).toMatch(/remove it in the source file/);
        expect(r).not.toMatch(/\.ssl/);
    });
});

it("derives conditionEditable from ifPure (gates the option alone) and absence of a condition", () => {
    const data: SSLDialogData = {
        entryPoints: ["Node001"],
        nodes: [
            {
                name: "Node001",
                line: 1,
                callTargets: [],
                replies: [],
                faithful: true,
                options: [
                    { type: "NOption", msgId: 101, target: "Node002", line: 2 }, // unconditional
                    {
                        type: "NOption",
                        msgId: 102,
                        target: "Node003",
                        line: 3,
                        conditional: "(x)",
                        condRange: { start: 0, end: 3 },
                        ifRange: { start: 0, end: 9 },
                        ifPure: true,
                    },
                    {
                        type: "NOption",
                        msgId: 104,
                        target: "Node004",
                        line: 4,
                        conditional: "(y)",
                        condRange: { start: 10, end: 13 },
                        ifRange: { start: 10, end: 19 },
                        ifPure: false,
                    },
                ],
            },
        ],
    };
    const model = modelFromSSL(data);
    const choices = model.roots[0]!.states[0]!.choices;
    expect(choices[0]!.conditionEditable).toBe(true); // unconditional
    expect(choices[1]!.conditionEditable).toBe(true); // pure if (gates this option alone)
    expect(choices[2]!.conditionEditable).toBe(false); // shared/impure if
    expect(choices[1]!.condRange).toEqual({ start: 0, end: 3 });
    expect(choices[1]!.ifRange).toEqual({ start: 0, end: 9 });
});
