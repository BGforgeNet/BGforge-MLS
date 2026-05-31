import type { Model } from "./model";
import type { LayoutDescriptor, SectionDescriptor } from "./types";

/** Format ids whose named depth-0 groups should render as master-detail lists.
 *  Everything else renders as a form. MAP's variable collections are lists. */
const LIST_SECTION_NAMES: Record<string, ReadonlySet<string>> = {
    map: new Set(["Global Variables", "Local Variables", "Scripts", "Objects"]),
};

export function buildLayout(formatId: string, model: Model): LayoutDescriptor {
    const listNames = LIST_SECTION_NAMES[formatId] ?? new Set<string>();
    const sections: SectionDescriptor[] = model.nodes
        .filter((n) => n.depth === 0 && n.kind === "group")
        .map((n) => ({
            id: n.id,
            title: n.name,
            kind: listNames.has(n.name) ? "list" : "form",
            nodeId: n.id,
        }));
    return { formatId, sections };
}
