<script lang="ts">
    // Every per-row affordance drawn beside a field's value: picture, open chip, animation chip, jump chip and
    // diagnostics with the first quick fix. The one component every field renderer uses, so a row presents the
    // same wherever the layout placed it (docs/binary-editor-ui.md, the shared-layer rule); the doc link is not
    // here because it belongs beside the label. Renders sibling nodes with no wrapper, so it joins whatever
    // flex run the caller puts it in.
    //
    // The template has no whitespace between nodes (line breaks fall inside tags): it can render inside a title,
    // where any would join the title's text.
    //
    // The picture sits right after the value it renders and IS the open control when the target can be opened,
    // so the chip is suppressed for exactly those rows (showsOpenChip). The diagnostic marker is role="img" with
    // the message as its aria-label; the glyph itself is aria-hidden.
    import type { Diagnostic, Row } from "@bgforge/binary-editor";
    import { showsOpenChip, thumbnailOpens } from "../state/controls";
    import Icon from "../../../webview-ui/Icon.svelte";
    import AnimationLink from "./AnimationLink.svelte";
    import JumpLink from "./JumpLink.svelte";
    import OpenResourceLink from "./OpenResourceLink.svelte";
    import ResourceThumbnail from "./ResourceThumbnail.svelte";

    const { row, onedit, diagnostics = [], jumpChip = true, compact = false }: {
        row: Row;
        onedit: (id: string, v: number | string) => void;
        diagnostics?: Diagnostic[];
        // Cleared where the label itself is the jump control (a grid slot), so one action gets one control.
        jumpChip?: boolean;
        // A fixed-size cell (matrix, join, a title) has no room for a text button: the quick fix shows its icon
        // and carries its label as the accessible name and tooltip.
        compact?: boolean;
    } = $props();

    const diagTitle = $derived(diagnostics.map((d) => d.message).join("; "));
    const firstFix = $derived(diagnostics.find((d) => d.quickFix)?.quickFix);
    // Highest severity present drives the marker's icon/colour (error > warning > info).
    const severity = $derived(
        diagnostics.some((d) => d.severity === "error")
            ? "error"
            : diagnostics.some((d) => d.severity === "warning")
              ? "warning"
              : "info",
    );
    function applyFix(): void {
        for (const e of firstFix?.edits ?? []) onedit(e.nodeId, e.value);
    }
</script>
{#if row.thumbnail}<ResourceThumbnail target={row.thumbnail} opens={thumbnailOpens(row)}
/>{/if}{#if showsOpenChip(row)}<OpenResourceLink target={row.openTarget!}
/>{/if}{#if row.animationTarget}<AnimationLink target={row.animationTarget}
/>{/if}{#if jumpChip && row.link}<JumpLink link={row.link}
/>{/if}{#if diagnostics.length > 0}<span class="diag {severity}" role="img" aria-label={diagTitle}
    ><Icon name={severity === "info" ? "info" : "warning"} title={diagTitle} /></span
>{#if firstFix}{#if compact}<button type="button" class="quick-fix compact" aria-label={firstFix.label}
    title={firstFix.label} onclick={applyFix}><Icon name="wrench" /></button
>{:else}<button type="button" class="quick-fix" onclick={applyFix}><Icon name="wrench" />{firstFix.label}</button
>{/if}{/if}{/if}
