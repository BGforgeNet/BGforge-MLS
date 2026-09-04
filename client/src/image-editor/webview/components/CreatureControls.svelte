<script lang="ts">
    // Which creature's colours to draw an IE creature animation in. The animation itself ships placeholder
    // gradients the engine replaces per creature, so without a creature chosen it renders in those - green
    // hair, blue armour. Purely a view setting: the document's own palette is untouched, and only an
    // export bakes the choice in.
    import type { CreatureOption } from "../messages";

    const {
        creatures,
        active,
        onrequest,
        onchoose,
    }: {
        creatures: CreatureOption[];
        active: string | undefined;
        /** Ask the host for the list. Called on first interaction - most files are never recoloured. */
        onrequest: () => void;
        onchoose: (resref: string | null) => void;
    } = $props();

    let query = $state("");
    // Reactive: the empty-state note below reads it, so a plain field would never re-render.
    let requested = $state(false);

    function ensureLoaded(): void {
        if (requested) return;
        requested = true;
        onrequest();
    }

    // Matching creatures first (the host ordered them), then the rest; the filter keeps that order.
    const shown = $derived.by(() => {
        const needle = query.trim().toLowerCase();
        const hits =
            needle === ""
                ? creatures
                : creatures.filter(
                      (c) => c.resref.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle),
                  );
        // Capped: an install holds thousands, and a select that long is slower to open than to search.
        return hits.slice(0, 200);
    });
    const matchCount = $derived(creatures.filter((c) => c.matches).length);
    const label = (c: CreatureOption): string => (c.name === "" ? c.resref : `${c.name} (${c.resref})`);
</script>

<div class="view-controls" role="group" aria-label="Creature colours">
    <div class="view-field">
        <span class="view-label">Creature</span>
        <select
            class="creature-select"
            value={active ?? ""}
            onfocus={ensureLoaded}
            onchange={(e) => onchoose((e.currentTarget as HTMLSelectElement).value || null)}
        >
            <option value="">Placeholder colours</option>
            {#each shown as creature (creature.resref)}
                <option value={creature.resref}>{creature.matches ? "* " : ""}{label(creature)}</option>
            {/each}
        </select>
    </div>
    <div class="view-field">
        <span class="view-label">Find</span>
        <input
            class="creature-search"
            type="search"
            placeholder="Name or resref"
            bind:value={query}
            onfocus={ensureLoaded}
        />
    </div>
    {#if requested && creatures.length === 0}
        <p class="creature-note">No creatures - open a game to draw this in real colours.</p>
    {:else if matchCount > 0}
        <p class="creature-note">{matchCount} use this animation (marked *).</p>
    {/if}
</div>
