<script lang="ts">
    // The one place a set is chosen. It is a permanent part of the animations tab rather than a state of
    // it - drawn from the moment the tab opens, holding no value until something is picked - so the tab
    // never rearranges itself around the reader mid-choice. The drawn surface's own controls column omits
    // its set row here, which is what keeps this the only one.
    import { type SetTile } from "../messages";
    import { setOptions } from "../set-options";
    import Combobox from "../../../webview-ui/Combobox.svelte";

    interface Props {
        sets: SetTile[];
        /** The set on the stage, where one is; empty before anything is chosen or while a file is drawn. */
        current?: number;
        onChoose: (id: number) => void;
    }

    const { sets, current, onChoose }: Props = $props();

    const options = $derived(setOptions(sets));
    const chosen = $derived(current !== undefined && sets.some((set) => set.id === current) ? String(current) : "");
    /** The reason the chosen set draws nothing, where it draws nothing. */
    const note = $derived(sets.find((set) => set.id === current)?.unsupported);
</script>

<div class="setpicker">
    <span class="facetlabel">Animation</span>
    <Combobox
        {options}
        value={chosen}
        onchange={(value) => onChoose(Number(value))}
        ariaLabel="Animation"
        placeholder={options.length === 0 ? "This install declares no animations" : "Type to search"}
        disabled={options.length === 0}
    />
    {#if note !== undefined}
        <p class="facetnone">{note}</p>
    {/if}
</div>
