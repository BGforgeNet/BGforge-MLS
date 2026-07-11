/**
 * Cross-language write-back PARITY for the weidu-d family (D <-> TD).
 *
 * Sibling of `dialog-cross-language-parity.test.ts` (which covers the fallout-ssl family, SSL <-> TSSL). The same
 * recurring bug class - a TypeScript-source write-back path silently DIVERGING from the plain-source path for some
 * edit operation - applies to the WeiDU-D family: `.d` splices through `applyDDialogEdits` (state-block oriented,
 * whole-state re-serialize with a per-field fallback), `.td` through `applyTDDialogEdits` (statement oriented,
 * surgical per-statement splices). The two write-backs are deliberately kept as separate implementations (their
 * span models genuinely differ - see each module's header), so this test asserts the PARITY invariant instead of
 * a shared implementation: the SAME logical dialog, the SAME model-level edit, driven through the SAME dispatcher
 * (`computeDialogSourceEdit`), must reparse to a STRUCTURALLY EQUIVALENT model in both variants.
 *
 * Reaction and low-INT variants are Fallout-SSL concepts (an `NOption` reaction arg / a low-INT option); they do
 * not exist in the WeiDU-D family, so the matrix is the fallout-ssl matrix minus those two ops.
 *
 * Equivalence is checked on a projection that strips byte-span and language-specific fields (a `.td` sourceRange
 * is not a `.d` sourceRange) and keeps the LOGICAL shape a modder sees: node ids and order, NPC lines, and each
 * option's text/condition/action/target.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { initParser } from "../../shared/parsers/weidu-d";
import { parseDDialog } from "../src/weidu-d/dialog";
import { parseTDSource } from "../src/td/dialog-source";
import {
    modelFromD,
    type DialogChoice,
    type DialogModel,
    type DialogState,
    type SourceLang,
} from "../../shared/dialog-model";
import {
    addReply,
    addState,
    deleteState,
    moveReply,
    removeReply,
    renameState,
    setChoiceTarget,
} from "../../shared/dialog-edit-ops";
import { computeDialogSourceEdit } from "../../client/src/dialog-editor/dialog-source-edit";

// --- Projection: the language-agnostic logical shape we assert parity on ---------------------------------------

interface ProjChoice {
    text: string;
    condition: string;
    action: string;
    target: string;
}
interface ProjState {
    id: string;
    text: string;
    trigger: string;
    choices: ProjChoice[];
}

const targetKey = (c: DialogChoice): string => {
    switch (c.target.kind) {
        case "state":
            return `state:${c.target.stateId}`;
        case "external":
            return `external:${c.target.label}`;
        case "exit":
            return "exit";
    }
};

const projectChoice = (c: DialogChoice): ProjChoice => ({
    text: (c.text ?? "").trim(),
    condition: (c.condition ?? "").trim(),
    action: (c.action ?? "").trim(),
    target: targetKey(c),
});

/**
 * Nodes in id order, each option in source order. A rename/reorder shows up as a changed id / choice order;
 * node order itself is not part of the logical shape (the two variants may lay states out differently), so
 * states are sorted by id before comparison.
 */
const project = (model: DialogModel): ProjState[] =>
    model.roots
        .flatMap((r) => r.states)
        .map(
            (s: DialogState): ProjState => ({
                id: s.id,
                text: (s.text ?? "").trim(),
                trigger: (s.trigger ?? "").trim(),
                choices: s.choices.map(projectChoice),
            }),
        )
        .sort((a, b) => a.id.localeCompare(b.id));

const clone = (m: DialogModel): DialogModel => structuredClone(m);

/** Apply the model edit through the real dispatcher, then reparse the spliced source back to a model. */
async function editAndReparse(
    lang: LangCase,
    edit: (edited: DialogModel, original: DialogModel) => void,
): Promise<ProjState[]> {
    const original = await lang.parse(lang.fixture);
    const edited = clone(original);
    edit(edited, original);
    const result = computeDialogSourceEdit(lang.fixture, edited, original);
    const newText = result.newText ?? lang.fixture;
    return project(await lang.parse(newText));
}

// --- Per-language cases: same logical dialog, one per source variant --------------------------------------------

interface LangCase {
    name: string;
    sourceLang: SourceLang;
    fixture: string;
    parse: (src: string) => Promise<DialogModel>;
}

/** Node001 offers two options (-> Node002, -> Node003); both targets are terminal reply nodes; the append list
 *  wires the three states with Node001 as the entry. Mirrors the SSL/TSSL parity fixture, in D-family form. */
const D_FIXTURE = `APPEND ~greeter~
IF ~~ THEN BEGIN Node001
  SAY @1
  ++ @101 + Node002
  ++ @102 + Node003
END
IF ~~ THEN BEGIN Node002
  SAY @2
  ++ @200 EXIT
END
IF ~~ THEN BEGIN Node003
  SAY @3
  ++ @300 EXIT
END
END
`;

const TD_FIXTURE = `const dlg = "greeter";

function Node001() {
    say(tra(1));
    reply(tra(101));
    goTo(Node002);
    reply(tra(102));
    goTo(Node003);
}

function Node002() {
    say(tra(2));
    reply(tra(200));
    exit();
}

function Node003() {
    say(tra(3));
    reply(tra(300));
    exit();
}

append(dlg, [Node001, Node002, Node003]);
`;

const dCase: LangCase = {
    name: "D",
    sourceLang: "d",
    fixture: D_FIXTURE,
    parse: (src) => Promise.resolve({ ...modelFromD(parseDDialog(src)), sourceLang: "d" }),
};

const tdCase: LangCase = {
    name: "TD",
    sourceLang: "td",
    fixture: TD_FIXTURE,
    parse: (src) => Promise.resolve({ ...modelFromD(parseTDSource(src)), sourceLang: "td", editable: true }),
};

// --- The parity matrix: every op asserted equal across the two variants of the weidu-d family -------------------

/** Find a state by id. */
const nodeById = (m: DialogModel, id: string): DialogState =>
    m.roots.flatMap((r) => r.states).find((s) => s.id === id)!;

type Op = (edited: DialogModel) => void;

const D_FAMILY_OPS: { name: string; op: Op }[] = [
    {
        name: "retarget an option to a different node",
        op: (m) => {
            const n = nodeById(m, "Node001");
            setChoiceTarget(n, n.choices[0]!.id, { kind: "state", stateId: "Node003" });
        },
    },
    {
        name: "reorder options within a node",
        op: (m) => {
            const n = nodeById(m, "Node001");
            moveReply(n, n.choices[0]!.id, 1);
        },
    },
    {
        name: "remove an option from a node",
        op: (m) => {
            const n = nodeById(m, "Node001");
            removeReply(n, n.choices[0]!.id);
        },
    },
    {
        name: "rename a node",
        op: (m) => {
            renameState(m, nodeById(m, "Node002"), "Node042");
        },
    },
    {
        name: "delete a node",
        op: (m) => {
            deleteState(m, nodeById(m, "Node003"));
        },
    },
    {
        name: "add an option to a node",
        op: (m) => {
            const n = nodeById(m, "Node001");
            const c = addReply(m, n);
            c.text = "New reply";
            c.target = { kind: "state", stateId: "Node002" };
        },
    },
    {
        // Node002 is reply-only (its lone option is terminal); a new option anchors at the node body's end, not
        // after a surviving sibling option - the divergent anchor path (D last-transition vs TD close-brace).
        name: "add an option to a terminal-only node",
        op: (m) => {
            const n = nodeById(m, "Node002");
            const c = addReply(m, n);
            c.text = "Another reply";
            c.target = { kind: "state", stateId: "Node003" };
        },
    },
    {
        name: "add a new node",
        op: (m) => {
            const s = addState(m);
            s.text = "A brand-new line";
        },
    },
    {
        name: "retarget an option to exit (terminal)",
        op: (m) => {
            const n = nodeById(m, "Node001");
            setChoiceTarget(n, n.choices[0]!.id, { kind: "exit" });
        },
    },
];

describe("cross-language parity: weidu-d family (D <-> TD)", () => {
    beforeAll(async () => {
        await initParser();
    });

    it("the fixtures are the same logical dialog before any edit", async () => {
        const d = project(await dCase.parse(dCase.fixture));
        const td = project(await tdCase.parse(tdCase.fixture));
        expect(td).toEqual(d);
    });

    for (const { name, op } of D_FAMILY_OPS) {
        it(`${name} -> D and TD reparse to equivalent models`, async () => {
            const dResult = await editAndReparse(dCase, (edited) => op(edited));
            const tdResult = await editAndReparse(tdCase, (edited) => op(edited));
            expect(tdResult).toEqual(dResult);
        });
    }
});
