<script lang="ts">
    import type { SectionDescriptor } from "@bgforge/binary-editor";
    import Tabs from "./primitives/Tabs.svelte";
    const { sections, activeId, onselect }:
        { sections: SectionDescriptor[]; activeId: string | undefined;
          onselect: (id: string) => void } = $props();
</script>
{#if sections.length > 1}
    <Tabs
        variant="primary"
        orientation="horizontal"
        tabs={sections.map((s) => ({ id: s.id, label: s.title }))}
        active={activeId ?? sections[0].id}
        {onselect}
        ariaLabel="File sections"
    />
{/if}
