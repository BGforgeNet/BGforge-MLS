<script lang="ts">
    // The same searchable combobox every other picker in these webviews uses: an install declares hundreds
    // of animations, so choosing one is a search, and this control already carries the substring match, the
    // keyboard operation and the rendered-row cap that needs.
    import { type SetTile } from "../messages";
    import Combobox from "../../../webview-ui/Combobox.svelte";

    interface Props {
        sets: SetTile[];
        /** The set on the stage, if it is one of these. */
        current?: number;
        onChoose: (id: number) => void;
    }

    const { sets, current, onChoose }: Props = $props();

    const hex = (id: number): string => `0x${id.toString(16).padStart(4, "0")}`;

    /**
     * The id is in every label, not just where two sets share a name.
     *
     * It is the reference the tables key on, so it is what a reader arrives with from a creature's
     * animation field - and it is what tells a family's generations apart when their names do not.
     *
     * A set that draws nothing says so IN the option rather than being dropped or disabled: it is a real
     * animation the tables name, the reason is below the picker once it is chosen, and a row that silently
     * vanished would read as the picker having forgotten it.
     */
    const options = $derived(
        sets.map((set) => ({
            value: String(set.id),
            label:
                set.resref === undefined
                    ? `${set.label} ${hex(set.id)} - draws nothing`
                    : `${set.label} ${hex(set.id)} (${set.resref})`,
        })),
    );
    const chosen = $derived(current !== undefined && sets.some((set) => set.id === current) ? String(current) : "");
    /** The reason the chosen set draws nothing, where it draws nothing - the note the list used to carry. */
    const note = $derived(sets.find((set) => set.id === current)?.unsupported);
</script>

<div class="setpicker">
    <span class="facetlabel">Animation</span>
    <Combobox
        {options}
        value={chosen}
        onchange={(value) => onChoose(Number(value))}
        ariaLabel="Animation"
        placeholder={options.length === 0 ? "No animation matches these filters" : "Type to search"}
        disabled={options.length === 0}
    />
    {#if note !== undefined}
        <p class="facetnone">{note}</p>
    {/if}
</div>
