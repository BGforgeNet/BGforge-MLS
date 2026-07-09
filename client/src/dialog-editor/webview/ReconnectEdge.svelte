<script lang="ts">
    // A bezier edge whose TARGET END is draggable: grab the dot at the arrow end and drop
    // it on another node to relink that transition to a new target (the source end is fixed
    // - a transition belongs to its state). The dot sits just left of the target node's
    // handle, on the edge's horizontal approach (targetPosition is Left) and in the open gap
    // before the node, so it is grabbable - an anchor at the exact endpoint is occluded by
    // the node's own connection handle (a higher layer). The host's onreconnect applies it.
    // `data.locked` (an edge out of a read-only/derived state) hides the anchor entirely.
    import { BaseEdge, EdgeReconnectAnchor, getBezierPath, type EdgeProps } from "@xyflow/svelte";

    let { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, markerEnd, style, data }: EdgeProps = $props();

    const bezier = $derived(getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }));
    // `@xyflow/svelte` types `EdgeProps.data` as an untyped bag (`Record<string, unknown> | undefined`), so a
    // structural cast is the only way to read the `locked` flag the host sets; the read is a single optional
    // boolean that defaults falsy, so a shape mismatch degrades safely to "unlocked" rather than throwing.
    const locked = $derived(Boolean((data as { locked?: boolean } | undefined)?.locked));
</script>

<BaseEdge path={bezier[0]} {markerEnd} {style} />
{#if !locked}
    <EdgeReconnectAnchor type="target" position={{ x: targetX - 18, y: targetY }} size={12} class="dlg-reconnect-anchor" />
{/if}
