<script lang="ts">
    import type { Row } from "@bgforge/binary-editor";
    import { enumOptionList } from "../../state/controls";
    import Select from "../primitives/Select.svelte";
    import Combobox from "../primitives/Combobox.svelte";

    const { row, onedit, searchable = false }: {
        row: Row;
        onedit: (value: number) => void;
        /** Render a searchable combobox instead of a plain dropdown. Opt-in per field via the layout's
         * `searchable` list (e.g. the ~300 IE opcodes); never inferred from option count. */
        searchable?: boolean;
    } = $props();
    const options = $derived(enumOptionList(row));
    const current = $derived(typeof row.rawValue === "number" ? row.rawValue : Number(row.rawValue));

    // Control is spec-driven: a field is an enum because the spec declares `enum:`, so it renders as a
    // dropdown. Select carries bits-ui's built-in keyboard typeahead, so even moderately large enums stay
    // usable. A field explicitly marked `searchable` in the layout uses the substring-search Combobox
    // instead (allowCustom=false: pick from the list; out-of-range values surface as Unknown(N)).
</script>

{#if searchable}
    <Combobox {options} value={current} onchange={onedit} disabled={!row.editable}
              allowCustom={false} ariaLabel={row.name} />
{:else}
    <Select {options} value={current} onchange={onedit} disabled={!row.editable} ariaLabel={row.name} />
{/if}
