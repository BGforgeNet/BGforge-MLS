<script lang="ts">
    import type { SectionDescriptor } from "@bgforge/binary-editor";
    const { sections, activeId, onselect }:
        { sections: SectionDescriptor[]; activeId: string | undefined;
          onselect: (id: string) => void } = $props();
</script>
{#if sections.length > 1}
    <div class="tabs" role="tablist">
        {#each sections as s}
            <button role="tab" aria-selected={s.id === activeId} class:active={s.id === activeId}
                    onclick={() => onselect(s.id)}>{s.title}</button>
        {/each}
    </div>
{/if}
