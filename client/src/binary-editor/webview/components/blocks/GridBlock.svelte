<script lang="ts">
    // Flat grid of label + control cells (the critter Skills block, the CRE sound slots). Clumps left.
    import type { FieldRef, Row } from "@bgforge/binary-editor";
    import { controlWidthClass, showsOpenChip, thumbnailOpens } from "../../state/controls";
    import { useJump } from "../../state/jump-context";
    import CellControl from "../CellControl.svelte";
    import DocLink from "../DocLink.svelte";
    import OpenResourceLink from "../OpenResourceLink.svelte";
    import ResourceThumbnail from "../ResourceThumbnail.svelte";

    const { columns, items, fields, onedit }: {
        columns: number;
        items: FieldRef[];
        fields: Record<FieldRef, Row>;
        onedit: (id: string, v: number | string) => void;
    } = $props();
    const jump = useJump();

    /** Matches the `.skill` column-gap in styles.css. */
    const LABEL_CONTROL_GAP = 10;

    const cells = $derived(
        items
            .map((ref) => ({ ref, row: fields[ref] }))
            .filter((c): c is { ref: FieldRef; row: Row } => c.row !== undefined),
    );
    /**
     * Multi-column layout, not a fixed N-column grid: the schema's `columns` is the MAXIMUM, and the browser
     * drops to fewer when the panel cannot hold them - a narrow window, a split editor, or labels three times
     * longer than the schema's generic ones (a CRE sound slot named from the game's own SNDSLOT.IDS). A fixed
     * count simply overflowed. Multicol also keeps the column-major reading order this editor wants, and a
     * cross-record jump link stays in the label position it already occupied.
     *
     * The two widths are measured rather than declared: a cell is its label plus a tier-sized control, neither
     * known here. `--nm-w` is the widest label, applied to every cell so controls line up down a column;
     * `--col-w` is the widest whole cell, the minimum width a column may take.
     */
    function fitColumns(node: HTMLElement, _cells: unknown) {
        const measure = (): void => {
            // Measure natural widths, so a previous pass's uniform label track cannot ratchet the next one wider.
            node.style.removeProperty("--nm-w");
            node.style.removeProperty("--col-w");
            let label = 0;
            let control = 0;
            for (const el of node.querySelectorAll<HTMLElement>(".nm")) label = Math.max(label, el.scrollWidth);
            for (const el of node.querySelectorAll<HTMLElement>(".field-control")) {
                control = Math.max(control, el.scrollWidth);
            }
            // The two halves are measured apart and summed, rather than taking the widest whole cell: the widest
            // label and the widest control rarely sit in the same cell, and a whole-cell measurement would size
            // every column to a pairing that does not exist.
            node.style.setProperty("--nm-w", `${Math.ceil(label)}px`);
            node.style.setProperty("--col-w", `${Math.ceil(label + control) + LABEL_CONTROL_GAP}px`);
        };
        // After the row values land, not during this update - measuring now would read the previous content.
        // One frame in flight at a time: each re-measure supersedes the pending one, and `destroy` cancels
        // whichever is outstanding. Tracking only the FIRST handle leaked a callback per update and let a
        // measure run against a node already removed from the DOM.
        let pending = 0;
        const schedule = (): void => {
            cancelAnimationFrame(pending);
            pending = requestAnimationFrame(measure);
        };
        schedule();
        return { update: schedule, destroy: () => cancelAnimationFrame(pending) };
    }
</script>
<div class="grid" style={`column-count:${columns}`} use:fitColumns={cells}>
    {#each cells as cell (cell.row.id)}
        <div class="skill">
            {#if cell.row.link && jump}
                {@const link = cell.row.link}
                <!-- The slot LABEL is the jump link. For a CRE item slot the label ("Weapon 2") NAMES the linked
                     record - the referenced Items entry IS "Weapon 2" - so the label itself is the natural,
                     unambiguous affordance to jump to. (Contrast the MAP script-SID chip in Field.svelte, where
                     the label names the FIELD and the link target is a reverse-referenced object, so a separate
                     chip is correct there.) It is a real button: keyboard-operable with a visible focus ring. -->
                <button
                    type="button"
                    class="nm nm-link"
                    title={`Go to ${link.label}`}
                    onclick={() => jump(link)}>{cell.row.name}</button>
            {:else}
                <span class="nm" title={cell.row.description ?? ""}>{cell.row.name}<DocLink url={cell.row.docUrl} description={cell.row.description} /></span>
            {/if}
            <!-- Wrap in the same sized .field-control Field.svelte uses, so a dropdown in a grid cell is sized
                 to its longest option instead of falling to the combobox's intrinsic (clipping) width. -->
            <span class="field-control {controlWidthClass(cell.row)}">
                <CellControl row={cell.row} {onedit} />
            </span>
            <!-- Per `webview/AGENTS.md`, a per-field affordance covers every block renderer, not just the kv
                 form - a grid cell holding a resref (a CRE item slot) offers the same open chip and, where the
                 target is a picture, the same thumbnail. -->
            {#if cell.row.thumbnail}
                <ResourceThumbnail target={cell.row.thumbnail} opens={thumbnailOpens(cell.row)} />
            {/if}
            {#if showsOpenChip(cell.row)}
                <OpenResourceLink target={cell.row.openTarget!} />
            {/if}
        </div>
    {/each}
</div>
