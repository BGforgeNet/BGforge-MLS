/**
 * Tests for the dialog webview's keyboard-shortcut predicates. DialogGraph.svelte binds these on
 * window and is otherwise DOM wiring (covered by the e2e harness); the chord decision lives in the
 * pure module so it gates in the client vitest run. The cross-platform case (Cmd on macOS) is the
 * one worth guarding - a Ctrl-only check would silently break save on a Mac.
 */

import { describe, expect, test } from "vitest";
import { isSaveShortcut } from "../src/dialog-editor/webview/keyboard";

const ev = (o: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; key: string }>) => ({
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    key: "",
    ...o,
});

describe("isSaveShortcut", () => {
    test("Ctrl+S (Windows/Linux) is a save chord", () => {
        expect(isSaveShortcut(ev({ ctrlKey: true, key: "s" }))).toBe(true);
    });

    test("Cmd+S (macOS metaKey) is a save chord", () => {
        expect(isSaveShortcut(ev({ metaKey: true, key: "s" }))).toBe(true);
    });

    test("uppercase S (Shift held) still matches", () => {
        expect(isSaveShortcut(ev({ ctrlKey: true, key: "S" }))).toBe(true);
    });

    test.each([
        ["no modifier", ev({ key: "s" })],
        ["a different key", ev({ ctrlKey: true, key: "a" })],
        ["Alt held (Ctrl+Alt+S is a different chord)", ev({ ctrlKey: true, altKey: true, key: "s" })],
        ["modifier alone, no key", ev({ ctrlKey: true, key: "" })],
    ])("%s is not a save chord", (_label, e) => {
        expect(isSaveShortcut(e)).toBe(false);
    });
});
