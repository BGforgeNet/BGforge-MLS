<script lang="ts">
    // A game file's way to its whole animation set: the row a set tab carries as its Set picker, pointed at
    // the sets drawing this file instead of every set the install declares. Only for a file read out of the
    // game - the set draws the install's copy, so for a file on disk it would show something else.
    //
    // One button whatever the count, and the host decides what it does: the only set opens, several ask
    // which. Recoloured creatures and class variants share their files, so several is common rather than rare.
    import type { AnimationView } from "../messages";

    const { sets, onOpen }: { sets: NonNullable<AnimationView["drawnBy"]>; onOpen: () => void } = $props();

    const only = $derived(sets.length === 1 ? sets[0] : undefined);
</script>

<div class="view-controls" role="group" aria-label="Animation sets drawing this file">
    <label
        class="view-field"
        title={only === undefined
            ? `Drawn by ${sets.map((set) => set.title).join(", ")}`
            : "Open the whole animation set this file belongs to"}
    >
        <span class="view-label">Set</span>
        <button type="button" class="set-pick" onclick={onOpen}>
            {only === undefined ? `Open one of ${sets.length} sets...` : `Open ${only.title}`}
        </button>
    </label>
</div>
