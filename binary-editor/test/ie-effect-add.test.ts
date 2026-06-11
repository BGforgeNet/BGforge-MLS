import { describe, expect, it } from "vitest";
import { buildLayout } from "../src/layout";
import { structureOp } from "../src/structure-ops";
import type { EditorSession } from "../src/session";
import type { FlatNode } from "../src/model";
import { ITM_FIXTURE, itmFixturePresent, openItmSession } from "./ie-fixture";

const maybe = itmFixturePresent() ? describe : describe.skip;

function groupNamed(session: EditorSession, name: string): FlatNode {
    const g = session.model.nodes.find((n) => n.kind === "group" && n.name === name);
    if (!g) throw new Error(`no ${name} group in ${ITM_FIXTURE}`);
    return g;
}
function childCount(session: EditorSession, parentId: string): number {
    return (session.model.childrenByParent.get(parentId) ?? []).length;
}
function firstChildId(session: EditorSession, parentId: string): string {
    const kid = (session.model.childrenByParent.get(parentId) ?? [])[0];
    if (kid === undefined) throw new Error("parent has no children");
    return session.model.nodes[kid]!.id;
}

maybe("ITM effect add wiring", () => {
    it("the layout exposes Effects section-add and an Abilities child-add of Effects", () => {
        const session = openItmSession();
        const layout = buildLayout("itm", session.model, session.relationshipModel).layout!;
        expect(layout.sections["Effects"]?.canAdd).toBe(true);
        expect(layout.sections["Abilities"]?.childAddSection).toBe("Effects");
    });

    it("section add on Effects grows the Effects table by one (a global effect)", () => {
        const session = openItmSession();
        const effects = groupNamed(session, "Effects");
        const before = childCount(session, effects.id);
        const res = structureOp(session, { op: "add", sectionId: effects.id });
        expect(res.changeSet.dirty).toBe(true);
        // The Effects group node id is stable across the rebuild; re-resolve by name to count.
        expect(childCount(session, groupNamed(session, "Effects").id)).toBe(before + 1);
    });

    it("addChild on an ability grows the Effects table by one (owner-scoped)", () => {
        const session = openItmSession();
        // A misc item may carry no abilities; add one (it seeds an effect) so an ability exists to target.
        structureOp(session, { op: "add", sectionId: groupNamed(session, "Abilities").id });
        const effectsBefore = childCount(session, groupNamed(session, "Effects").id);
        const abilityId = firstChildId(session, groupNamed(session, "Abilities").id);
        const res = structureOp(session, { op: "addChild", entryId: abilityId, childSection: "Effects" });
        expect(res.changeSet.dirty).toBe(true);
        expect(childCount(session, groupNamed(session, "Effects").id)).toBe(effectsBefore + 1);
        // The op keeps the parent ability selected (the child lands in another section).
        expect(res.selection).toBe(firstChildId(session, groupNamed(session, "Abilities").id));
    });

    it("addChild with an unknown child section is a safe no-op", () => {
        const session = openItmSession();
        structureOp(session, { op: "add", sectionId: groupNamed(session, "Abilities").id });
        const effectsBefore = childCount(session, groupNamed(session, "Effects").id);
        const undoBefore = session.undo.length;
        const abilityId = firstChildId(session, groupNamed(session, "Abilities").id);
        structureOp(session, { op: "addChild", entryId: abilityId, childSection: "Nope" });
        // No new effect, no new undo entry - the unknown pairing produced no bytes.
        expect(childCount(session, groupNamed(session, "Effects").id)).toBe(effectsBefore);
        expect(session.undo.length).toBe(undoBefore);
    });
});
