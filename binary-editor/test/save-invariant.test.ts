import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatAdapterRegistry, type ParsedField } from "@bgforge/binary";
import { openSession, sessionStore } from "../src/session";
import { serializeSession } from "../src/serialize";
import { editField } from "../src/edit";
import type { FlatNode } from "../src/model";

const ITM_FIXTURE = path.resolve(__dirname, "../../grammars/weidu-tp2/test/samples/core/items/misc8j.itm");

function openItm() {
    const bytes = new Uint8Array(fs.readFileSync(ITM_FIXTURE));
    const res = openSession("file:///misc8j.itm", bytes);
    const session = sessionStore.get(res.sessionId);
    return { bytes, res, session };
}

describe("save invariant - relationship model is presentation-only", () => {
    it("round-trips an unedited ITM byte-for-byte through the editor session", () => {
        if (!fs.existsSync(ITM_FIXTURE)) return;
        const { bytes, res, session } = openItm();
        expect(res.errors).toEqual([]);
        expect(session).toBeDefined();
        // The relationship model is registered for itm, so it is active on this session.
        expect(session!.relationshipModel).toBeDefined();
        const out = serializeSession(session!);
        expect(Buffer.from(out).equals(Buffer.from(bytes))).toBe(true);
    });

    it("an edit survives serialize + reparse (single save path, no overlay leakage)", () => {
        if (!fs.existsSync(ITM_FIXTURE)) return;
        const { res, session } = openItm();
        expect(res.errors).toEqual([]);
        expect(session).toBeDefined();
        if (!session) return;

        // Locate the "Weight" field in the ITM header: uint32, not locked, safe
        // to bump by 1. Found at id "0/27" from the parsed tree; we look it up
        // by name to avoid hardcoding positional ids that could shift.
        const weightNode = session.model.nodes.find((n): n is FlatNode => n.kind === "field" && n.name === "Weight");
        expect(weightNode).toBeDefined();
        if (!weightNode) return;

        const originalValue = (weightNode.source as ParsedField).value as number;
        const newValue = originalValue + 1;

        editField(session, weightNode.id, newValue);
        const out = serializeSession(session);

        // Reparse the serialized bytes through a fresh session and verify the
        // field now carries the edited value.
        const reparsed = openSession("file:///misc8j-reparsed.itm", out);
        expect(reparsed.errors).toEqual([]);
        const reparsedSession = sessionStore.get(reparsed.sessionId);
        expect(reparsedSession).toBeDefined();
        if (!reparsedSession) return;

        const reparsedWeight = reparsedSession.model.nodes.find(
            (n): n is FlatNode => n.kind === "field" && n.name === "Weight",
        );
        expect(reparsedWeight).toBeDefined();
        if (!reparsedWeight) return;
        expect((reparsedWeight.source as ParsedField).value).toBe(newValue);
    });

    it("the strict snapshot succeeds on the clean ITM document", () => {
        // The cleanest negative case (feeding an out-of-domain closed-enum
        // value at the canonical-document level) would require hand-mutating
        // the opaque canonical doc object, which is an internal type not
        // exported from @bgforge/binary. The strict rejection path for
        // out-of-domain values is covered by binary/test/pro-canonical-
        // writer-strict-gate.test.ts, which targets PRO's closed `objectType`
        // enum. Here we assert the positive: createJsonSnapshot does NOT throw
        // on the clean ITM doc, confirming the editor does not bypass the
        // strict path by silently passing invalid data.
        if (!fs.existsSync(ITM_FIXTURE)) return;
        const { res, session } = openItm();
        expect(res.errors).toEqual([]);
        expect(session).toBeDefined();
        if (!session) return;

        const adapter = formatAdapterRegistry.get("itm");
        expect(adapter).toBeDefined();
        if (!adapter) return;

        // Strict canonical snapshot must not throw on well-formed parsed data.
        let snapshot: string | undefined;
        expect(() => {
            snapshot = adapter.createJsonSnapshot(session.model.parseResult);
        }).not.toThrow();
        expect(typeof snapshot).toBe("string");
        expect((snapshot as string).length).toBeGreaterThan(0);
    });
});
