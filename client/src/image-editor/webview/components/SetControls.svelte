<script lang="ts">
    // The two controls a whole animation set adds to the editor: which armour level, and which stance.
    // Everything else on this surface is the single-file editor unchanged, which is the point - a set is
    // not a second viewer, it is the same one with a picker for what it is pointed at.
    //
    // ONE stance list rather than a file picker and a band picker. Which file holds a given stance is a
    // convention of the naming family - the same creature ships as ten single-band files under one and
    // three packed ones under another - so choosing the file first asks the reader about packaging. The
    // file is still what a save writes, which is why each row names it in its tooltip.
    //
    // Plain selects rather than the searchable combobox the creature picker uses: an armour level offers at
    // most four options and a stance list around twenty, all of them visible at once in a native list.
    //
    // The SET is the exception: an install declares hundreds, so choosing one is a search rather than a
    // list, and the host's own quick pick already is that search. This is the button that opens it - and
    // it is omitted where the surface around this column already carries a set picker of its own, so one
    // panel never offers the same choice twice.
    import type { SetView } from "../messages";

    const {
        set,
        showChoice = true,
        onArmourChange,
        onStanceChange,
        onPickSet,
        onConvert,
    }: {
        /**
         * Null while nothing is chosen: this column is drawn from the moment its tab opens, so the Stance
         * picker and the convert button hold their places and fill in when a set arrives.
         */
        set: SetView | null;
        /** Whether choosing the SET belongs here, or to the surface around this column. */
        showChoice?: boolean;
        onArmourChange: (level: number) => void;
        onStanceChange: (key: string) => void;
        onPickSet: () => void;
        /** Open the conversion mode, which takes over this column while it is up. */
        onConvert: () => void;
    } = $props();

    // On the control itself as well as the row, so the open stance's file is readable without opening the
    // list - which is where a reader about to edit would look for it.
    const openStance = $derived(set?.stances.find((stance) => stance.key === set.stance));
</script>

<div class="view-controls" role="group" aria-label="Animation set">
    {#if showChoice}
        <label class="view-field" title="Which animation set this editor is pointed at">
            <span class="view-label">Set</span>
            <button type="button" class="set-pick" onclick={onPickSet}>
                {set?.title ?? "Choose a set..."}
            </button>
        </label>
    {/if}
    {#if set !== null && set.armours.length > 1}
        <label class="view-field" title="Which armour level's files this set draws from">
            <span class="view-label">Armour</span>
            <select
                value={String(set.armour)}
                onchange={(e) => onArmourChange(Number(e.currentTarget.value))}
                aria-label="Armour level"
            >
                {#each set.armours as level (level.level)}
                    <option value={String(level.level)}>{level.label}</option>
                {/each}
            </select>
        </label>
    {/if}
    <label class="view-field" title={openStance?.title ?? "Which of the set's animations to show"}>
        <span class="view-label">Stance</span>
        <select
            class="set-action"
            value={set?.stance}
            onchange={(e) => onStanceChange(e.currentTarget.value)}
            disabled={set === null}
            aria-label="Set stance"
        >
            {#if set === null}
                <option value="">No set chosen</option>
            {/if}
            {#each set?.stances ?? [] as stance (stance.key)}
                <!-- The file this row's art lives in - what a save writes, and the only place it shows. -->
                <option value={stance.key} title={stance.title}>{stance.label}</option>
            {/each}
        </select>
    </label>
    <button type="button" class="convert-open" onclick={onConvert} disabled={set === null}>
        Convert this set...
    </button>
</div>
