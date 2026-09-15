<script lang="ts">
    // "Animation" chip beside a field whose value names a creature animation. The host sets
    // `row.animationTarget` whenever a game is open - including for an id no table names, which is exactly
    // the one worth going to look at; the gallery says what it found there rather than this chip guessing.
    //
    // Distinct from OpenResourceLink, which opens one file: this opens the browser over a family of them.
    import type { Row } from "@bgforge/binary-editor";
    import { useOpenAnimation } from "../state/open-animation-context";

    const { target }: { target: NonNullable<Row["animationTarget"]> } = $props();
    const open = useOpenAnimation();
</script>

{#if open}
    <button
        type="button"
        class="jump-link"
        title={`Browse animation 0x${target.id.toString(16).padStart(4, "0")}`}
        onclick={() => open(target.id)}
    >
        <span class="jump-arrow" aria-hidden="true">-&gt;</span>animation
    </button>
{/if}
