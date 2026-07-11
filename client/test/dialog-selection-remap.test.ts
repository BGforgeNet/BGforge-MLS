/**
 * Tests for remapChoiceId - the linchpin of the "adopt the faithful re-parse but keep the selection" path.
 *
 * When the webview adopts a freshly-parsed model in place (DialogGraph.adoptModel), an EXISTING option keeps
 * its positional id and resolves directly, but a JUST-ADDED option does NOT: the webview names it `<node>#reply`
 * while pending, and the parser re-names it to the positional `<node>#optN` once it is spliced into the source.
 * The host reports the old-id -> allocated-`@N` mapping so the webview can re-find the option by its `@N`. This
 * is the exact fold the selection-preservation depends on; get it wrong and a just-added option loses selection
 * on every re-parse.
 */

import { describe, expect, test } from "vitest";
import { remapChoiceId } from "../src/dialog-editor/webview/state-lookup";
import type { DialogChoice, DialogState } from "../../shared/dialog-model";

function choice(id: string, text?: string): DialogChoice {
    return { id, text, target: { kind: "exit" } };
}
function state(choices: DialogChoice[]): DialogState {
    return { id: "Node1", text: "", choices };
}

describe("remapChoiceId", () => {
    test("an existing option keeps its id (resolves directly, allocations irrelevant)", () => {
        const s = state([choice("Node1#opt0", "@100"), choice("Node1#opt1", "@101")]);
        expect(remapChoiceId("Node1#opt1", s, undefined)).toBe("Node1#opt1");
        // Even with an allocation table present, a still-valid id short-circuits before the @N match.
        expect(remapChoiceId("Node1#opt1", s, { "Node1#reply": "@200" })).toBe("Node1#opt1");
    });

    test("a just-added option (pending `#reply` id) re-resolves to its parsed `#optN` via the allocated @N", () => {
        // Post-parse the appended option is `Node1#opt1` carrying its allocated `@200`; the selection still holds
        // the pending id `Node1#reply`, which the host maps to `@200`.
        const s = state([choice("Node1#opt0", "@100"), choice("Node1#opt1", "@200")]);
        expect(remapChoiceId("Node1#reply", s, { "Node1#reply": "@200" })).toBe("Node1#opt1");
    });

    test("returns null when the pending id has no allocation (nothing to match on)", () => {
        const s = state([choice("Node1#opt0", "@100")]);
        expect(remapChoiceId("Node1#reply", s, undefined)).toBeNull();
        expect(remapChoiceId("Node1#reply", s, {})).toBeNull();
    });

    test("returns null when the allocated @N is absent from the new parse (option was removed in source)", () => {
        const s = state([choice("Node1#opt0", "@100")]);
        expect(remapChoiceId("Node1#reply", s, { "Node1#reply": "@200" })).toBeNull();
    });
});
