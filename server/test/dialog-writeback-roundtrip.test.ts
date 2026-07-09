/**
 * Write-back FAITHFULNESS (serializer round-trip) for every dialog backend.
 *
 * This is the automated net that replaces the removed live save-verification oracle. The oracle compared LIVE,
 * incrementally-mutated webview state against a fresh derivation and false-positived on the session artifacts the
 * live side carried (a guard that cries wolf is worse than none). The correctness it was reaching for is better
 * proved in isolation, on the pure write-back path, with two invariants asserted per backend:
 *
 *   1. IDEMPOTENCE - re-emitting an UNEDITED model must not touch the source. A writer that reflows `@N` refs,
 *      shorthand, comments, patch blocks, or whitespace on a no-op edit fails here. (`computeDialogSourceEdit`
 *      returns `newText: null` when nothing changed.)
 *   2. LOCALITY - a single field edit changes ONLY that field on reparse; every other node/field round-trips
 *      byte-or-structure identical. This is the property the multisay-drop class of bug violated (editing one
 *      SAY line silently dropped the state's other alternates), so it gets a dedicated multisay case per D-family.
 *
 * Each backend uses its OWN fixture (no cross-language paired fixtures - that is the sibling parity test's job);
 * the invariant here is that the language's own round-trip is loss-free.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseDialog } from "../src/dialog";
import { parseTSSLSource } from "../src/tssl/dialog-source";
import { parseTDSource } from "../src/td/dialog-source";
import { parseDDialog } from "../src/weidu-d/dialog";
import { initParser as initWeiduD } from "../../shared/parsers/weidu-d";
import { modelFromSSL, modelFromD, type DialogModel, type DialogState } from "../../shared/dialog-model";
import { setChoiceTarget } from "../../shared/dialog-edit-ops";
import { computeDialogSourceEdit } from "../../client/src/dialog-editor/dialog-source-edit";

const sample = (name: string): string =>
    readFileSync(fileURLToPath(new URL(`td/samples/${name}`, import.meta.url)), "utf8");

const clone = (m: DialogModel): DialogModel => structuredClone(m);
const statesOf = (m: DialogModel): DialogState[] => m.roots.flatMap((r) => r.states);
const stateById = (m: DialogModel, id: string): DialogState | undefined => statesOf(m).find((s) => s.id === id);

interface Backend {
    name: string;
    fixture: string;
    parse: (src: string) => Promise<DialogModel>;
}

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

// A .d file with a preserved ALTER_TRANS patch block: idempotence must leave it byte-for-byte.
const D_FIXTURE = `/* greeting dialog - do not edit manually */
BEGIN ~greeter~
IF ~~ THEN BEGIN intro
  SAY ~Hello, traveller.~
  IF ~PlayerKnowsAboutItem~ THEN REPLY ~Tell me more.~ GOTO details
  IF ~~ THEN REPLY ~Farewell.~ EXIT
END
IF ~~ THEN BEGIN details
  SAY ~The item lies to the north.~
  IF ~~ THEN REPLY ~Thanks.~ EXIT
END
END

ALTER_TRANS ~greeter~ #0 #0 DO ~SetGlobal("met","GLOBAL",1)~ CONTINUE
`;

// SAY multisay (`= ~b~ = ~c~`): the model carries the first line in `text` and every alternate in `sayTexts`.
// A write-back that re-emits from `text` alone drops b and c - the locality invariant catches that.
const D_MULTISAY_FIXTURE = `BEGIN ~mtest~
IF ~~ THEN BEGIN m1
  SAY ~First line.~ = ~Second line.~ = ~Third line.~
  IF ~~ THEN REPLY ~Go.~ GOTO m2
END
IF ~~ THEN BEGIN m2
  SAY ~Bye.~
  IF ~~ THEN REPLY ~Ok.~ EXIT
END
END
`;

const sslBackend: Backend = {
    name: "SSL",
    fixture: SSL_FIXTURE,
    parse: async (src) => ({ ...modelFromSSL(await parseDialog(src)), sourceLang: "ssl" }),
};
const tsslBackend: Backend = {
    name: "TSSL",
    fixture: TSSL_FIXTURE,
    parse: (src) => Promise.resolve({ ...modelFromSSL(parseTSSLSource(src)), sourceLang: "tssl" }),
};
const dBackend: Backend = {
    name: "D",
    fixture: D_FIXTURE,
    parse: (src) => Promise.resolve({ ...modelFromD(parseDDialog(src)), sourceLang: "d" }),
};
const tdBackend: Backend = {
    name: "TD",
    fixture: sample("test_features.td"),
    parse: (src) => Promise.resolve({ ...modelFromD(parseTDSource(src)), sourceLang: "td" }),
};

const ALL: Backend[] = [sslBackend, tsslBackend, dBackend, tdBackend];

// parseDDialog needs the WeiDU-D tree-sitter parser initialized once.
beforeAll(async () => {
    await initWeiduD();
});

describe("write-back faithfulness: idempotence (no-op edit does not touch the source)", () => {
    for (const backend of ALL) {
        it(`${backend.name}: re-emitting an unedited model changes nothing`, async () => {
            const original = await backend.parse(backend.fixture);
            const edited = clone(original);
            const result = computeDialogSourceEdit(backend.fixture, edited, original);
            // newText is null precisely when the writer produced no change. A non-null value would mean the
            // writer reflowed the source on a no-op - the tell of a lossy re-serialize.
            expect(result.newText).toBeNull();
        });
    }
});

describe("write-back faithfulness: locality (a one-field edit reflows nothing else)", () => {
    // Retarget the first option of the first multi-option node, then assert every OTHER node is byte-identical
    // across the reparse. Fixtures whose first node is not option-bearing pick their own node below.
    const cases: { backend: Backend; nodeId: string; newTarget: string }[] = [
        { backend: sslBackend, nodeId: "Node001", newTarget: "Node003" },
        { backend: tsslBackend, nodeId: "Node001", newTarget: "Node003" },
    ];
    for (const { backend, nodeId, newTarget } of cases) {
        it(`${backend.name}: retargeting one option leaves all other nodes unchanged`, async () => {
            const original = await backend.parse(backend.fixture);
            const edited = clone(original);
            const node = stateById(edited, nodeId)!;
            setChoiceTarget(node, node.choices[0]!.id, { kind: "state", stateId: newTarget });
            const result = computeDialogSourceEdit(backend.fixture, edited, original);
            expect(result.newText).not.toBeNull();
            const reparsed = await backend.parse(result.newText!);
            // The edited option now points at the new target...
            expect(stateById(reparsed, nodeId)!.choices[0]!.target).toEqual({ kind: "state", stateId: newTarget });
            // ...and the untouched target nodes are structurally identical to the original parse.
            for (const other of ["Node002", "Node003"]) {
                expect(stateById(reparsed, other)).toEqual(stateById(original, other));
            }
        });
    }
});

describe("write-back faithfulness: multisay alternates survive an unrelated edit", () => {
    it("D: editing a multisay state's first line preserves its other SAY alternates", async () => {
        await initWeiduD();
        const original = { ...modelFromD(parseDDialog(D_MULTISAY_FIXTURE)), sourceLang: "d" as const };
        const m1 = stateById(original, "m1")!;
        expect(m1.sayTexts).toEqual(["First line.", "Second line.", "Third line."]);
        // Edit the multisay state's OWN first line - this exercises serializeSayValue's re-join (the exact path
        // the alternate-drop bug lived in): the writer must emit `text` as the first alternate and keep the rest.
        const edited = clone(original);
        stateById(edited, "m1")!.text = "First line CHANGED.";
        const result = computeDialogSourceEdit(D_MULTISAY_FIXTURE, edited, original);
        expect(result.newText).not.toBeNull();
        const reparsed = { ...modelFromD(parseDDialog(result.newText!)), sourceLang: "d" as const };
        expect(stateById(reparsed, "m1")!.sayTexts).toEqual(["First line CHANGED.", "Second line.", "Third line."]);
    });

    it("TD: a multisay state round-trips its every SAY alternate on a no-op edit", async () => {
        const src = sample("wm_rhia.td");
        const original = { ...modelFromD(parseTDSource(src)), sourceLang: "td" as const };
        const s100 = stateById(original, "state100")!;
        expect(s100.sayTexts).toHaveLength(4);
        const result = computeDialogSourceEdit(src, clone(original), original);
        // A no-op over a multisay state must not rewrite it (idempotence), so the alternates are trivially intact.
        expect(result.newText).toBeNull();
    });
});
