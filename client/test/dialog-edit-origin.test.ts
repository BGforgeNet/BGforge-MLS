import { describe, it, expect } from "vitest";
import { EchoGuard } from "../src/dialog-editor/edit-origin";

describe("EchoGuard", () => {
    it("suppresses one change per self-edit, then re-projects", () => {
        const g = new EchoGuard();
        g.markSelfEdit();
        expect(g.shouldReproject()).toBe(false); // our own edit echoes back - skip
        expect(g.shouldReproject()).toBe(true); // a later external edit re-projects
    });

    it("re-projects an external change with no pending self-edit", () => {
        const g = new EchoGuard();
        expect(g.shouldReproject()).toBe(true);
    });

    it("balances multiple queued self-edits", () => {
        const g = new EchoGuard();
        g.markSelfEdit();
        g.markSelfEdit();
        expect(g.shouldReproject()).toBe(false);
        expect(g.shouldReproject()).toBe(false);
        expect(g.shouldReproject()).toBe(true);
    });
});
