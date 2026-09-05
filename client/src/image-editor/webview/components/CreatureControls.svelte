<script lang="ts">
    // Which creature's colours to draw an IE creature animation in. The animation itself ships placeholder
    // gradients the engine replaces per creature, so without a creature chosen it renders in those - green
    // hair, blue armour. Purely a view setting: the document's own palette is untouched, and only an
    // export bakes the choice in.
    //
    // The same searchable combobox the binary editor gives every enum and resref field: it carries the
    // substring search, the keyboard operation and the rendered-row cap an install of thousands needs, so
    // there is no second dropdown-plus-search to keep in step with it.
    import type { CreatureOption } from "../messages";
    import Combobox from "../../../webview-ui/Combobox.svelte";
    import Checkbox from "../../../webview-ui/Checkbox.svelte";
    import { shouldFetchCreatures } from "../state/creature-list";

    const {
        creatures,
        active,
        onrequest,
        onchoose,
    }: {
        creatures: CreatureOption[];
        active: string | undefined;
        /** Ask the host for the list. Called on first open - most files are never recoloured. */
        onrequest: () => void;
        onchoose: (resref: string | null) => void;
    } = $props();

    // Drawing in the file's own palette is a choice like any other, so it is an option rather than a cleared
    // field - the combobox never yields an empty value. Parentheses cannot occur in a resref, so the sentinel
    // cannot collide with a real creature.
    const NONE = "(none)";
    const NONE_LABEL = "Placeholder colours";

    // Reactive: the empty-state note below reads it, so a plain field would never re-render.
    let requested = $state(false);
    function load(): void {
        if (!shouldFetchCreatures(requested, creatures.length)) return;
        requested = true;
        onrequest();
    }

    // Creatures using THIS animation are the ones whose colours the file was drawn for, so they are the
    // default offer; the rest are a deliberate widening. Kept on when the animation has no user at all - a
    // filter to an empty list would read as a broken picker rather than as an answer.
    let onlyMatching = $state(true);
    const matchCount = $derived(creatures.filter((c) => c.matches).length);
    const offered = $derived(onlyMatching && matchCount > 0 ? creatures.filter((c) => c.matches) : creatures);

    // Matched creatures keep the host's ordering (it put them first); the star repeats that in the label,
    // which is what a search result shows once the ordering is filtered away. Redundant while filtered - every
    // row would carry one - so it is only drawn when the list is showing the others too.
    const options = $derived([
        { value: NONE, label: NONE_LABEL },
        ...offered.map((c) => ({
            value: c.resref,
            label: `${c.matches && !onlyMatching ? "* " : ""}${c.name === "" ? c.resref : `${c.name} (${c.resref})`}`,
        })),
    ]);
</script>

<div class="view-controls" role="group" aria-label="Palette from">
    <div class="view-field">
        <span class="view-label">Palette from</span>
        <div class="creature-picker">
            <Combobox
                {options}
                value={active ?? NONE}
                onchange={(v) => onchoose(v === NONE ? null : v)}
                onopen={load}
                ariaLabel="Palette from"
            />
        </div>
    </div>
    <Checkbox
        label="Only creatures using this animation"
        checked={onlyMatching}
        onchange={(next) => {
            onlyMatching = next;
            // Its own state says nothing until the list exists, and the note below counts it.
            load();
        }}
    />
    {#if !requested}
        <!-- Nothing is known before the list is asked for, and a count of an unfetched list would be a lie. -->
    {:else if creatures.length === 0}
        <p class="creature-note">No creatures - open a game to draw this in real colours.</p>
    {:else if matchCount === 0}
        <p class="creature-note">No creature uses this animation - showing all.</p>
    {:else if !onlyMatching}
        <p class="creature-note">{matchCount} use this animation (marked *).</p>
    {/if}
</div>
