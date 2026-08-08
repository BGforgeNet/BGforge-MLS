<script lang="ts">
    // A small inline picture of what a resref field points at - an item's icon, a creature's portrait. The host
    // marks the row (`row.thumbnail`) when the open game HAS the resource and its type can be drawn; the bytes
    // are fetched here, so a record with fifty picture fields costs fifty small requests rather than one huge
    // message.
    //
    // The picture is also the LINK: where the target can be opened, clicking the image opens it, and the row
    // drops the textual `-> ext` chip (see `showsOpenChip`). One control for one action, and the one that says
    // what it will show. Where nothing can open the target the same image renders inert.
    //
    // The box is fixed and present from the first paint, before any bytes exist, because the alternative
    // reflows: a picture that appeared on arrival would push every control in the row. So the empty box, the
    // loading box and the "the game lost it" box are all the same size, and only the pixels differ.
    import type { Row } from "@bgforge/binary-editor";
    import { useOpenResource } from "../state/open-resource-context";
    import { useThumbnail } from "../state/thumbnail-context";

    const { target, opens }: { target: NonNullable<Row["thumbnail"]>; opens?: Row["openTarget"] } = $props();
    const load = useThumbnail();
    const open = useOpenResource();
    // Keyed on the target so an edit to the resref re-fetches: `$derived` re-runs when `target` changes, and the
    // bridge's cache makes a repeat of an already-seen resource free.
    const source = $derived(load === undefined ? undefined : load(target.resref, target.ext));
    // Both must hold: a target something can open, and a handler in context to open it with (a view with no
    // open handler renders the picture as decoration, exactly as JumpLink does for navigation).
    const clickable = $derived(opens !== undefined && open !== undefined);
    const label = $derived(`Open ${target.resref}.${target.ext.toLowerCase()}`);
</script>

{#snippet picture()}
    {#await source then dataUri}
        {#if dataUri}
            <!-- Empty alt: when the picture is a link the button's own aria-label names it, and when it is not,
                 the field beside it already spells the resref. Either way alt text would repeat. -->
            <img src={dataUri} alt="" />
        {/if}
    {:catch}
        <!-- A failed fetch leaves the reserved box empty. The field's value is unaffected, so a broken-image
             marker would be noise about the preview rather than about the record. -->
    {/await}
{/snippet}

<!-- Two real elements over one `<svelte:element>`: a button is only a button to assistive tech (and to Svelte's
     own a11y checks) when it is written as one. The shared picture is a snippet so neither branch copies it.
     An icon-only control has no visible text, so the tooltip is its NAME rather than a repeat of the label
     beside it - the one case the project's tooltip rule requires one. -->
{#if load}
    {#if clickable}
        <button class="thumb linked" type="button" title={label} aria-label={label} onclick={() => open?.(opens!)}>
            {@render picture()}
        </button>
    {:else}
        <span class="thumb">{@render picture()}</span>
    {/if}
{/if}
