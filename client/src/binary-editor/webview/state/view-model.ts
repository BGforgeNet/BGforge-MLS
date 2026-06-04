import type { LayoutDescriptor, NodeId, SectionDescriptor } from "@bgforge/binary-editor";

export class ViewModel {
    private layout: LayoutDescriptor;
    private activeId: string | undefined;
    selectedEntity: NodeId | undefined;
    private expanded = new Set<NodeId>();

    constructor(layout: LayoutDescriptor) {
        this.layout = layout;
        this.activeId = layout.sections[0]?.id;
    }

    get sections(): SectionDescriptor[] {
        return this.layout.sections;
    }
    get activeSection(): SectionDescriptor | undefined {
        return this.layout.sections.find((s) => s.id === this.activeId);
    }

    selectSection(id: string): void {
        this.activeId = id;
        this.selectedEntity = undefined;
    }

    /** The namePath addEntry should target: the active list section's group name, else undefined. */
    addEntryNamePath(): string[] | undefined {
        const s = this.activeSection;
        return s && s.kind === "list" ? [s.title] : undefined;
    }

    isExpanded(id: NodeId): boolean {
        return this.expanded.has(id);
    }

    toggleExpanded(id: NodeId): void {
        if (this.expanded.has(id)) {
            this.expanded.delete(id);
        } else {
            this.expanded.add(id);
        }
    }
}
