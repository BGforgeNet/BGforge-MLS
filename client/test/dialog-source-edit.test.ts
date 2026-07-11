import { describe, expect, it } from "vitest";
import { computeDialogSourceEdit } from "../src/dialog-editor/dialog-source-edit";
import { modelFromSSL, type DialogModel, type DialogState } from "../../shared/dialog-model";
import type { SSLDialogData } from "../../shared/dialog-types";

// A minimal WeiDU D document with two states; retargeting the transition changes the source text.
const D_SRC = [
    "BEGIN test",
    "IF ~~ THEN BEGIN hello",
    "  SAY @0",
    "  IF ~~ THEN GOTO more",
    "END",
    "IF ~~ THEN BEGIN more",
    "  SAY @1",
    "  IF ~~ THEN EXIT",
    "END",
].join("\n");

// Hand-built DialogModel rather than parsed: client/test has no D-parser fixture helper (parsing
// lives in server/src, out of bounds for a client-side unit test), so this test hand-builds the
// parser's output shape directly. computeDialogSourceEdit only needs a DialogModel with real
// sourceRange offsets into D_SRC - it does not re-test the D parser itself, only the splice/id-allocation
// wrapper.
//
// Each state's sourceRange is derived from D_SRC via indexOf (not hand-counted), so it stays correct
// if the fixture text above is ever edited.
function stateRange(startNeedle: string): { start: number; end: number } {
    const start = D_SRC.indexOf(startNeedle);
    if (start === -1) throw new Error(`fixture text does not contain "${startNeedle}"`);
    const end = D_SRC.indexOf("END", start) + "END".length;
    return { start, end };
}

// Builds a fresh DialogModel on every call so a test mutating "edited" never affects "original".
function buildModel(): DialogModel {
    const hello: DialogState = {
        id: "hello",
        text: "@0",
        trigger: "",
        choices: [{ id: "hello_0", target: { kind: "state", stateId: "more" }, condition: "" }],
        sourceRange: stateRange("IF ~~ THEN BEGIN hello"),
    };
    const more: DialogState = {
        id: "more",
        text: "@1",
        trigger: "",
        choices: [{ id: "more_0", target: { kind: "exit" }, condition: "" }],
        sourceRange: stateRange("IF ~~ THEN BEGIN more"),
    };
    return {
        sourceLang: "d",
        editable: true,
        roots: [{ id: "test", label: "test", kind: "dialog", states: [hello, more] }],
        messages: {},
    };
}

describe("computeDialogSourceEdit", () => {
    it("returns null newText when the model is unchanged", () => {
        const model = buildModel();
        const result = computeDialogSourceEdit(D_SRC, model, model);
        expect(result.newText).toBeNull();
        // An unchanged model authors no new content, so the D-family allocator mints nothing; messages pass through.
        expect(result.messages).toEqual({});
    });

    it("returns spliced text when a transition is retargeted", () => {
        const original = buildModel();
        const edited = buildModel();
        // Retarget hello's only transition from `more` to EXIT.
        const hello = edited.roots.flatMap((r) => r.states).find((s) => s.id === "hello")!;
        hello.choices[0]!.target = { kind: "exit" };
        const result = computeDialogSourceEdit(D_SRC, edited, original);
        expect(result.newText).not.toBeNull();
        expect(result.newText).toContain("EXIT");
        // A retarget touches no new content, so nothing is allocated; the existing (empty) message set passes through.
        expect(result.messages).toEqual({});
    });

    it("no-ops every writer when the original parse is missing (a from-scratch model has no source)", () => {
        // Each family arm gates on `original`: with none there is nothing to splice against, so the text
        // passes through unchanged for all four source languages (uniform since the D legacy path was removed).
        for (const lang of ["d", "td", "tssl", "ssl"] as const) {
            const edited = { ...buildModel(), sourceLang: lang };
            expect(computeDialogSourceEdit(D_SRC, edited, null).newText).toBeNull();
        }
    });

    it("throws on an unhandled sourceLang instead of silently splicing as SSL", () => {
        // The dispatch is exhaustive over the SourceLang union; an unknown value (only reachable via a cast,
        // e.g. a future SourceLang member without a dispatch arm) must fail loud, not fall through to the SSL
        // writer or return the text unchanged. original=null bypasses the renderFamily allocation guard so this
        // exercises the dispatch itself.
        const edited = { ...buildModel(), sourceLang: "bogus" as DialogModel["sourceLang"] };
        expect(() => computeDialogSourceEdit(D_SRC, edited, null)).toThrow(/sourceLang/);
    });

    it("allocates a tra id for a NEW D state's literal say, splices its block, and reports its allocation", () => {
        // The on-disk .tra the client loaded: @0/@1 already exist, so the first free id is 2.
        const original = buildModel();
        original.messages = { "0": "hello line", "1": "more line" };
        const edited = buildModel();
        edited.messages = { ...original.messages };
        // A brand-new state (no sourceRange), authored with literal say/reply text.
        edited.roots[0]!.states.push({
            id: "extra",
            text: "A fresh line.",
            choices: [{ id: "extra#0", text: "Bye now.", target: { kind: "exit" } }],
        });
        const result = computeDialogSourceEdit(D_SRC, edited, original);
        expect(result.newText).not.toBeNull();
        // The literal say/reply were minted ascending ids above the max, and ride out in messages for the .tra.
        expect(result.messages["2"]).toBe("A fresh line.");
        expect(result.messages["3"]).toBe("Bye now.");
        // The new block is serialized with the allocated refs (SAY @2), after the last existing state.
        expect(result.newText).toContain("BEGIN extra");
        expect(result.newText).toContain("SAY @2");
        expect(result.newText!.indexOf("BEGIN extra")).toBeGreaterThan(result.newText!.indexOf("BEGIN more"));
        // Only the new state (no sourceRange) is reported as a pending allocation; existing states are not.
        expect(result.allocations).toEqual({ extra: "@2", "extra#0": "@3" });
    });
});

// --- Fallout SSL fixture: drives the allocateNodeIds/allocateOptionIds branch (dialog-source-edit.ts
// lines ~32-37), which the two D-only tests above never touch. Built the same way
// client/test/dialog-inspector-edit.test.ts builds SSL fixtures: a hand-written SSLDialogData fed
// through the real modelFromSSL adapter, not a hand-built DialogModel - so the node/choice shape
// (procRange, callRange, targetRange, stmtRange, insertAnchor) matches what the adapter actually
// produces. Real SSL source text so applySSLDialogEdits' splices land on genuine byte offsets.
const SSL_SRC = [
    "procedure Node001 begin",
    "    NOption(101, Node002, 4);",
    "end",
    "procedure Node002 begin Reply(200); end",
    "procedure talk_p_proc begin call Node001; end",
    "",
].join("\n");

// Byte span of `needle`'s first occurrence at or after `from` (not hand-counted, so it stays correct
// if SSL_SRC is ever edited).
function span(needle: string, from = 0): { start: number; end: number } {
    const start = SSL_SRC.indexOf(needle, from);
    if (start === -1) throw new Error(`fixture text does not contain "${needle}"`);
    return { start, end: start + needle.length };
}

const optCall = span("NOption(101, Node002, 4)");
const optTarget = span("Node002", optCall.start);
const optStmt = span("NOption(101, Node002, 4);");
const proc001Start = span("procedure Node001 begin").start;
const proc001End = span("end", optStmt.end).end;

const SSL_DATA: SSLDialogData = {
    entryPoints: ["Node001"],
    messages: { "101": "Existing option text", "200": "Existing reply text" },
    newProcAnchor: span("procedure talk_p_proc").start,
    nodes: [
        {
            name: "Node001",
            line: 1,
            faithful: true,
            replies: [],
            callTargets: [],
            options: [
                {
                    msgId: 101,
                    target: "Node002",
                    type: "NOption",
                    line: 2,
                    skill: 4,
                    callRange: optCall,
                    targetRange: optTarget,
                    stmtRange: optStmt,
                },
            ],
            insertAnchor: { offset: optStmt.end, indent: "    " },
            procRange: { start: proc001Start, end: proc001End },
        },
        {
            name: "Node002",
            line: 4,
            faithful: true,
            replies: [{ msgId: 200, line: 4 }],
            options: [],
            callTargets: [],
        },
    ],
};

// Builds a fresh DialogModel on every call (mirrors buildModel() above) so mutating "edited" never
// affects "original".
function buildSSLModel(): DialogModel {
    return modelFromSSL(SSL_DATA);
}

describe("computeDialogSourceEdit - fallout-ssl id allocation", () => {
    it("allocates ids for a new node and a new option, splices both, and merges the ids into messages", () => {
        const original = buildSSLModel();
        const edited = buildSSLModel();

        // A brand-new node: no procRange, literal (unallocated) reply text - drives allocateNodeIds.
        edited.roots[0]!.states.push({ id: "Node050", text: "New node reply text", choices: [] });
        // A brand-new option on the EXISTING Node001, targeting the new node: no callRange, literal
        // text - drives allocateOptionIds (allocateNodeIds only allocates a NEW node's own options).
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        n1.choices.push({
            id: "Node001#new0",
            text: "New choice text",
            target: { kind: "state", stateId: "Node050" },
        });

        const result = computeDialogSourceEdit(SSL_SRC, edited, original);

        expect(result.newText).not.toBeNull();
        // The new node's procedure is spliced in with its allocated reply id (201: first free after 101/200).
        expect(result.newText).toContain("procedure Node050 begin\n    Reply(201);\nend");
        // The new option is spliced into Node001 with its allocated id (202), after the surviving option.
        expect(result.newText).toContain("NOption(101, Node002, 4);\n    NOption(202, Node050, 0);");

        // Both newly-allocated ids merged into messages, alongside the pre-existing ones.
        expect(result.messages).toEqual({
            "101": "Existing option text",
            "200": "Existing reply text",
            "201": "New node reply text",
            "202": "New choice text",
        });
    });

    it("allocates + splices a Reply for a faithful reply-less EXISTING node whose NPC line the user typed (the +State save path)", () => {
        // Node001 is faithful, has an insertAnchor, and carries no Reply in source -> `replyless`. After the user
        // types its first NPC line (a literal in the working model), save must mint an @N and splice Reply(@N)
        // into the procedure - the save side of the +State fix, driven by the shared `replyless` field.
        const original = buildSSLModel();
        const edited = buildSSLModel();
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        expect(original.roots[0]!.states.find((s) => s.id === "Node001")!.replyless).toBe(true);
        n1.text = "Hello, traveler.";

        const result = computeDialogSourceEdit(SSL_SRC, edited, original);
        // Next free id after 101/200 is 201; Reply(201) spliced at the node's body anchor, entry added to .msg.
        expect(result.newText).toContain("Reply(201);");
        expect(result.messages!["201"]).toBe("Hello, traveler.");
    });

    it("does NOT mint an orphan @N for a non-faithful reply-less node (the writer can't splice a Reply there)", () => {
        // A non-faithful node has no round-trippable body, so `replyOps`/`nodeOps` never splice a Reply into it.
        // The allocator must therefore not mint an @N for its text - that id would land in the .msg referenced by
        // nothing. Gating allocation on `state.replyless` (faithful + anchor), the SAME field the UI gate reads,
        // instead of a bare empty-text check, closes that orphan. (Text edits are UI-locked on such a node; this
        // pins the writer's own robustness and the shared-field alignment.)
        const data: SSLDialogData = {
            entryPoints: ["Node001"],
            messages: {},
            nodes: [
                {
                    name: "Node001",
                    line: 1,
                    faithful: false, // structured/approximate: not round-trippable -> not `replyless`
                    replies: [],
                    options: [],
                    callTargets: [],
                    procRange: { start: 0, end: 27 },
                },
            ],
        };
        const original = modelFromSSL(data);
        const edited = modelFromSSL(data);
        expect(original.roots[0]!.states[0]!.replyless).toBeUndefined();
        edited.roots[0]!.states[0]!.text = "orphan literal";

        const result = computeDialogSourceEdit("procedure Node001 begin end", edited, original);
        expect(result.messages).toEqual({}); // no id minted for a Reply that can never be spliced
    });
});
