<script lang="ts">
    import { type FacetFamily, type FacetState } from "../messages";

    interface Props {
        state: FacetState;
        onSelect: (family: FacetFamily, value: string) => void;
    }

    const { state, onSelect }: Props = $props();

    /**
     * The five controls, in the order they act.
     *
     * The first three re-resolve WHICH animation is being looked at; the last two pick a file within it.
     * The gap between the groups is the only thing that says so, which is why they are one list rather than
     * two components.
     */
    const families = $derived([
        { key: "race" as const, label: "Race", options: state.races, value: state.selection.race },
        { key: "gender" as const, label: "Gender", options: state.genders, value: state.selection.gender },
        { key: "charClass" as const, label: "Class", options: state.classes, value: state.selection.charClass },
        {
            key: "armour" as const,
            label: "Armour",
            options: state.armours,
            value: String(state.selection.armour),
        },
        { key: "action" as const, label: "Action", options: state.actions, value: state.selection.action },
    ]);
</script>

<div class="facetbar">
    {#each families as family (family.key)}
        <label class="facet">
            <span class="facetlabel">{family.label}</span>
            <!-- An option this game has no animation for stays in the list, disabled, carrying the reason
                 as its title: hiding it would read as the picker having forgotten the combination. -->
            <select
                value={family.value}
                aria-label={family.label}
                onchange={(event) => onSelect(family.key, event.currentTarget.value)}
            >
                {#each family.options as option (option.value)}
                    <option value={option.value} disabled={!option.available} title={option.reason ?? ""}>
                        {option.label}
                    </option>
                {/each}
            </select>
        </label>
    {/each}
</div>
