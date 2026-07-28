<script lang="ts">
    // "Open" chip beside a resref whose target the OPEN GAME actually has. The host resolves which of the
    // field's declared candidate types exists and sets `row.openTarget`; absent means either no game or nothing
    // to open, and in both cases nothing renders - a missing resource is never marked, because a mod record
    // legitimately references what a later install step creates.
    //
    // Distinct from JumpLink, which navigates WITHIN this record; this opens a different resource entirely.
    import type { Row } from "@bgforge/binary-editor";
    import { useOpenResource } from "../state/open-resource-context";

    const { target }: { target: NonNullable<Row["openTarget"]> } = $props();
    const open = useOpenResource();
</script>

{#if open}
    <button
        type="button"
        class="jump-link"
        title={`Open ${target.resref}.${target.ext.toLowerCase()}`}
        onclick={() => open(target)}
    >
        <span class="jump-arrow" aria-hidden="true">-&gt;</span>{target.ext.toLowerCase()}
    </button>
{/if}
