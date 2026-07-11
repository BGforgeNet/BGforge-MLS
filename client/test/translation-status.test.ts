import { describe, expect, it } from "vitest";
import { translationHint, unresolvedRefCount } from "../src/dialog-editor/webview/translation-status";
import type { DialogModel, DialogState } from "../../shared/dialog-model";

const span = { start: 0, end: 1 };
// WeiDU D states carry NO procRange (that span is SSL-only). The count must still include them - a
// procRange gate would skip every D state and the banner would never fire on a real D file.
const dState = (id: string, text: string, choices: DialogState["choices"] = []): DialogState => ({
    id,
    text,
    choices,
});

function model(states: DialogState[], messages: Record<string, string>): DialogModel {
    return { sourceLang: "d", editable: true, messages, roots: [{ id: "d", label: "d", kind: "dialog", states }] };
}

describe("unresolvedRefCount", () => {
    it("counts @N refs (lines and options) on D states with no matching message entry", () => {
        // The whole point of the editor is to read the conversation; when the tra/msg path is misconfigured,
        // getMessages returns nothing and every @N renders as its raw ref. This count drives the banner that
        // tells the author to point the tra path (.bgforge.yml translation.directory or a @tra line). D states
        // carry no procRange, so this also guards against re-introducing a procRange gate that skips them all.
        const m = model(
            [
                dState("A", "@1", [{ id: "A#0", text: "@3", target: { kind: "exit" }, callRange: span }]),
                dState("B", "@2", []),
            ],
            { "1": "resolved line" }, // @2 and @3 are unresolved
        );
        expect(unresolvedRefCount(m)).toBe(2);
    });

    it("returns 0 when every ref resolves (and ignores literal, non-@N text)", () => {
        const m = model(
            [dState("A", "@1", [{ id: "A#0", text: "just literal", target: { kind: "exit" }, callRange: span }])],
            { "1": "hi" },
        );
        expect(unresolvedRefCount(m)).toBe(0);
    });

    it("ignores a just-added state with an empty line (no @N ref yet, so nothing to resolve)", () => {
        // A freshly-added state has empty/literal text until save allocates its @N, so msgRef is null and it
        // is not counted - no need to special-case pending items (and no spurious banner on add).
        const m = model([dState("New", "")], {});
        expect(unresolvedRefCount(m)).toBe(0);
    });
});

describe("translationHint", () => {
    // The unresolved-refs banner tells the author how to point the translation path. Its wording is
    // family-specific: Fallout SSL reads `.msg` files under the engine dialog path; WeiDU D reads `.tra`
    // files under the plain `tra` default. A single set of D-family words ("the tra path", "tra/english",
    // "name.tra") on a Fallout SSL file is wrong terminology - the whole point of this helper is that the two
    // families never share the other's vocabulary.
    it("gives Fallout SSL its .msg vocabulary (message path, engine dialog dir, .msg ext)", () => {
        expect(translationHint(true)).toEqual({
            pathWord: "message",
            dirExample: "data/text/english/dialog",
            ext: "msg",
        });
    });

    it("gives WeiDU D its .tra vocabulary (tra path, tra dir, .tra ext)", () => {
        expect(translationHint(false)).toEqual({
            pathWord: "tra",
            dirExample: "tra/english",
            ext: "tra",
        });
    });
});
