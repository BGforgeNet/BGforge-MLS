/**
 * Cross-language write-back PARITY.
 *
 * The dialog editor supports two SOURCE variants per render family: a plain form and a TypeScript-source form
 * that compiles to it (SSL <- TSSL in the `fallout-ssl` family; D <- TD in the `weidu-d` family). Each variant
 * has its own surgical write-back path, and the recurring class of bug has been the TS-source path silently
 * DIVERGING from the plain path for some edit operation ("TSSL parity"). Reviews caught these one instance at a
 * time; this test makes the invariant explicit instead: the SAME logical dialog, given the SAME model-level edit
 * and driven through the SAME dispatcher (`computeDialogSourceEdit`), must reparse to a STRUCTURALLY EQUIVALENT
 * model in both variants of a family. A variant that drops or mis-applies an operation the other honors fails
 * here, so parity is asserted rather than re-discovered.
 *
 * Equivalence is checked on a projection that strips the byte-span and language-specific fields (which legitimately
 * differ - a `.tssl` callRange is not a `.ssl` callRange) and keeps the LOGICAL shape a modder sees: node ids and
 * order, NPC lines, and each option's text/condition/action/target/reaction/low-INT flag.
 */

import { describe, expect, it } from "vitest";
import { parseDialog } from "../src/dialog";
import { parseTSSLSource } from "../src/tssl/dialog-source";
import {
    modelFromSSL,
    type DialogChoice,
    type DialogModel,
    type DialogState,
    type SourceLang,
} from "../../shared/dialog-model";
import {
    deleteState,
    moveReply,
    removeReply,
    renameState,
    setChoiceLowIq,
    setChoiceReaction,
    setChoiceTarget,
} from "../../shared/dialog-edit-ops";
import { computeDialogSourceEdit } from "../../client/src/dialog-editor/dialog-source-edit";

// --- Projection: the language-agnostic logical shape we assert parity on ---------------------------------------

interface ProjChoice {
    text: string;
    condition: string;
    action: string;
    target: string;
    reaction: string;
    lowIq: boolean;
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
    reaction: c.reaction ?? "neutral",
    lowIq: c.lowIq ?? false,
});

/**
 * Nodes in id order, each option in source order. A rename/reorder shows up as a changed id / choice order;
 * node order itself is not part of the logical shape (the two variants may lay procedures out differently), so
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

/** Node001 offers two options (-> Node002, -> Node003); both targets are terminal reply nodes; talk_p_proc enters. */
const SSL_FIXTURE = `procedure Node001 begin
    NOption(101, Node002, 4);
    NOption(102, Node003, 4);
end
procedure Node002 begin Reply(200); end
procedure Node003 begin Reply(300); end
procedure talk_p_proc begin call Node001; end
`;

const TSSL_FIXTURE = `function Node001() {
    NOption(101, Node002, 4);
    NOption(102, Node003, 4);
}
function Node002() { Reply(200); }
function Node003() { Reply(300); }
function talk_p_proc() { Node001(); }
`;

const sslCase: LangCase = {
    name: "SSL",
    sourceLang: "ssl",
    fixture: SSL_FIXTURE,
    parse: async (src) => ({ ...modelFromSSL(await parseDialog(src)), sourceLang: "ssl" }),
};

const tsslCase: LangCase = {
    name: "TSSL",
    sourceLang: "tssl",
    fixture: TSSL_FIXTURE,
    parse: (src) => Promise.resolve({ ...modelFromSSL(parseTSSLSource(src)), sourceLang: "tssl" }),
};

// --- The parity matrix: every op asserted equal across the two variants of the fallout-ssl family ---------------

/** Find a state / its nth option by position, resilient to id changes across the two variants. */
const nodeById = (m: DialogModel, id: string): DialogState =>
    m.roots.flatMap((r) => r.states).find((s) => s.id === id)!;

type Op = (edited: DialogModel) => void;

const SSL_FAMILY_OPS: { name: string; op: Op }[] = [
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
        name: "change an option's reaction to good",
        op: (m) => {
            const n = nodeById(m, "Node001");
            setChoiceReaction(n, n.choices[0]!.id, "good");
        },
    },
    {
        name: "toggle an option's low-INT variant",
        op: (m) => {
            const n = nodeById(m, "Node001");
            setChoiceLowIq(n, n.choices[0]!.id, true);
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
];

describe("cross-language parity: fallout-ssl family (SSL <-> TSSL)", () => {
    it("the fixtures are the same logical dialog before any edit", async () => {
        const ssl = project(await sslCase.parse(sslCase.fixture));
        const tssl = project(await tsslCase.parse(tsslCase.fixture));
        expect(tssl).toEqual(ssl);
    });

    for (const { name, op } of SSL_FAMILY_OPS) {
        it(`${name} -> SSL and TSSL reparse to equivalent models`, async () => {
            const sslResult = await editAndReparse(sslCase, (edited) => op(edited));
            const tsslResult = await editAndReparse(tsslCase, (edited) => op(edited));
            expect(tsslResult).toEqual(sslResult);
        });
    }
});
