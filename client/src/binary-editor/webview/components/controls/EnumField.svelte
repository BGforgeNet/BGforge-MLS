<script lang="ts">
    import type { Row } from "@bgforge/binary-editor";
    import { enumOptionList } from "../../state/controls";
    import Select from "../primitives/Select.svelte";
    import Combobox from "../primitives/Combobox.svelte";

    const { row, onedit }: { row: Row; onedit: (value: number) => void } = $props();
    const options = $derived(enumOptionList(row));
    const current = $derived(typeof row.rawValue === "number" ? row.rawValue : Number(row.rawValue));

    // Control is spec-driven: a field is an enum because the spec declares `enum:`, so it renders as a
    // dropdown. Select carries bits-ui's built-in keyboard typeahead, so moderately large enums stay
    // usable. A field whose spec marks it `searchableEnum` (the rare large enum, e.g. the ~300 IE opcodes)
    // renders the substring-search Combobox instead - declared in the spec, never inferred from option
    // count. allowCustom=false: pick from the list; out-of-range values surface as "<n> Unknown".
    const searchable = $derived(row.searchableEnum === true);
</script>

{#if searchable}
    <Combobox {options} value={current} onchange={onedit} disabled={!row.editable}
              allowCustom={false} ariaLabel={row.name} />
{:else}
    <Select {options} value={current} onchange={onedit} disabled={!row.editable} ariaLabel={row.name} />
{/if}
