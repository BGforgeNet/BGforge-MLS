<script lang="ts">
    import { type FilterControl } from "../set-filter";

    interface Props {
        controls: FilterControl[];
        onSelect: (family: FilterControl["family"], value: string) => void;
    }

    const { controls, onSelect }: Props = $props();
</script>

<!-- Each control narrows the list below it; none of them selects an animation. A family this corpus
     declares nothing for stays visible, fixed at Any and disabled, because its absence is a fact about the
     game rather than about the reader's filters - a Fallout install has critters, not classes. -->
<div class="setfilters">
    {#each controls as control (control.family)}
        <label class="facet">
            <span class="facetlabel">{control.label}</span>
            <select
                value={control.value}
                aria-label={control.label}
                disabled={!control.applicable}
                title={control.applicable ? "" : `This game's animations have no ${control.label.toLowerCase()}`}
                onchange={(event) => onSelect(control.family, event.currentTarget.value)}
            >
                {#each control.options as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                {/each}
            </select>
        </label>
    {/each}
</div>
