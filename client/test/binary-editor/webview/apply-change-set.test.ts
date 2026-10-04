import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { dispatch, type ChangeSet, type OpenResult, type ResolvedTab, type Row } from "@bgforge/binary-editor";
import { applyChangeSet } from "../../../src/binary-editor/webview/state/apply-change-set";

const PRO = path.resolve(__dirname, "../../../testFixture/proto/critters/00000029.pro");

function makeRow(id: string, rawValue?: number): Row {
    return { id, namePath: [id], depth: 0, kind: "field", name: id, rawValue };
}

function changeSet(changed: Row[], tabCounts?: ChangeSet["tabCounts"]): ChangeSet {
    return { changed, diagnostics: [], dirty: true, ...(tabCounts ? { tabCounts } : {}) };
}

/** A real open and a real edit of one of its numeric layout fields, through the session the worker runs. */
function openAndEdit(): { open: OpenResult; edit: ChangeSet; ref: string } {
    const opened = dispatch({
        type: "open",
        uri: pathToFileURL(PRO).href,
        bytes: new Uint8Array(fs.readFileSync(PRO)),
    });
    if (opened.type !== "opened" || !opened.result.layout.layout) throw new Error("fixture did not open");
    const fields = opened.result.layout.layout.fields;
    const [ref, target] = Object.entries(fields).find(([, r]) => r.valueType === "int32" && r.editable !== false)!;
    const edited = dispatch({
        type: "editField",
        sessionId: opened.result.sessionId,
        nodeId: target.id,
        value: Number(target.rawValue) + 1,
    });
    if (edited.type !== "edited") throw new Error(`edit refused: ${JSON.stringify(edited)}`);
    return { open: opened.result, edit: edited.result.changeSet, ref };
}

describe("applyChangeSet", () => {
    it("carries the edited value into the field the edit named", () => {
        const { open, edit, ref } = openAndEdit();
        const before = open.layout.layout!.fields;

        const next = applyChangeSet(open, edit);

        expect(next.layout.layout!.fields[ref]!.rawValue).toBe(Number(before[ref]!.rawValue) + 1);
    });

    it("leaves a field the changeSet does not name the same object", () => {
        const a = makeRow("a", 1);
        const b = makeRow("b", 2);
        const open: OpenResult = {
            sessionId: "s",
            format: "pro",
            formatName: "PRO",
            layout: { formatId: "pro", layout: { variantId: "v", rows: [], fields: { A: a, B: b }, sections: {} } },
            warnings: [],
            errors: [],
            rootWindow: [],
        };
        const a2 = { ...a, rawValue: 5 };

        const fields = applyChangeSet(open, changeSet([a2])).layout.layout!.fields;

        expect(fields.A).toBe(a2);
        expect(fields.B).toBe(b);
    });

    // The view is held raw, so a write into the old object would never reach it - and the old object is what
    // any open snapshot of it still shows.
    it("never writes into the result it was given", () => {
        const { open, edit, ref } = openAndEdit();
        const field = open.layout.layout!.fields[ref];

        const next = applyChangeSet(open, edit);

        expect(next).not.toBe(open);
        expect(open.layout.layout!.fields[ref]).toBe(field);
    });

    it("returns the same result when the changeSet touches nothing in it", () => {
        const { open } = openAndEdit();
        expect(applyChangeSet(open, changeSet([makeRow("no/such/node")]))).toBe(open);
    });

    it("updates the count of a nested tab and copies only the tabs on its path", () => {
        const spells: ResolvedTab = { id: "spells", label: "Spells", count: "1/0" };
        const inner: ResolvedTab = { id: "inner", label: "Inner", tabs: [spells] };
        const other: ResolvedTab = { id: "other", label: "Other", count: 3 };
        const open: OpenResult = {
            sessionId: "s",
            format: "cre",
            formatName: "CRE",
            layout: { formatId: "cre", layout: { variantId: "v", tabs: [inner, other], fields: {}, sections: {} } },
            warnings: [],
            errors: [],
            rootWindow: [],
        };

        const next = applyChangeSet(open, changeSet([], { spells: "2/1", other: 3 }));

        const [nextInner, nextOther] = next.layout.layout!.tabs!;
        expect(nextInner!.tabs![0]!.count).toBe("2/1");
        expect(nextOther).toBe(other);
        expect(spells.count).toBe("1/0");
    });
});
