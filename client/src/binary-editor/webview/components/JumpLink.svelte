<script lang="ts">
    // Shared cross-record jump-chip markup, extracted so Field.svelte (form/detail rows) and GridBlock.svelte
    // (the CRE item-slots grid) render the SAME affordance rather than each carrying its own copy. Renders
    // nothing when no jump handler is in context (a view with no navigable sections).
    import type { Row } from "@bgforge/binary-editor";
    import { useJump } from "../state/jump-context";
    const { link }: { link: NonNullable<Row["link"]> } = $props();
    const jump = useJump();
</script>
{#if jump}
    <button type="button" class="jump-link" title={`Go to ${link.label}`} onclick={() => jump(link)}>
        <span class="jump-arrow" aria-hidden="true">-&gt;</span>{link.label}
    </button>
{/if}
