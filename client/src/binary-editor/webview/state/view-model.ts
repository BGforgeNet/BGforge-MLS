import type { LayoutDescriptor, NodeId, SectionDescriptor } from "@bgforge/binary-editor";

export class ViewModel {
    private layout: LayoutDescriptor;
    private activeId: string | undefined;
    selectedEntity: NodeId | undefined;

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
}
