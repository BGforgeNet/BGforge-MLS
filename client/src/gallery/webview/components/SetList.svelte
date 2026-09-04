<script lang="ts">
    import { type SetTile } from "../messages";

    interface Props {
        sets: SetTile[];
        onOpen: (resref: string) => void;
        /** The animation the panel was opened on - its row is marked so the reader can see where they landed. */
        focus?: number;
    }

    const { sets, onOpen, focus }: Props = $props();

    const hex = (id: number): string => `0x${id.toString(16).padStart(4, "0")}`;
</script>

<!-- A list rather than a thumbnail grid for now: a set's picture needs its scheme resolved, and a scheme
     this build does not implement has no frame to show. Each row says which, so an unimplemented scheme
     reads as "not covered yet" rather than as missing content. -->
<ul class="setlist">
    {#each sets as set (set.id)}
        <li class="setrow">
            <button
                type="button"
                class="setopen"
                class:setfocus={set.id === focus}
                aria-current={set.id === focus ? "true" : undefined}
                disabled={set.resref === undefined}
                title={set.unsupported ?? `Open ${set.resref}`}
                onclick={() => set.resref && onOpen(set.resref)}
            >
                <span class="setname">{set.label}</span>
                <span class="setid">{hex(set.id)}</span>
                {#if set.resref !== undefined}
                    <span class="setresref">{set.resref}</span>
                {/if}
                {#if set.unsupported !== undefined}
                    <span class="setnote">{set.unsupported}</span>
                {/if}
            </button>
        </li>
    {/each}
</ul>
