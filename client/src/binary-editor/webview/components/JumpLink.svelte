<script lang="ts">
    // Cross-record jump chip for form/detail rows (Field.svelte): a "-> label" affordance beside a value whose
    // field REFERENCES another record (e.g. a MAP object's script SID -> its reverse-referenced object). The CRE
    // item-slots grid does NOT use this - there the slot LABEL itself is the link (see GridBlock.svelte), because
    // the label names the referent. Renders nothing when no jump handler is in context (a view with no navigable
    // sections).
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
