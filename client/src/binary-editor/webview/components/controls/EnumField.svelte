<script lang="ts">
    import type { Row } from "@bgforge/binary-editor";
    import { enumOptionList } from "../../state/controls";
    import Combobox from "../primitives/Combobox.svelte";

    const { row, onedit }: { row: Row; onedit: (value: number) => void } = $props();
    const options = $derived(enumOptionList(row));
    const current = $derived(typeof row.rawValue === "number" ? row.rawValue : Number(row.rawValue));

    // Every enum renders through the Combobox: substring search + a chevron on all dropdowns. An OPEN enum
    // (`enumOpen` - the advisory, mod-extensible tables) also lets the user type a custom numeric value, which
    // surfaces as "<n> Unknown" and round-trips (the codec accepts off-list values for these). A CLOSED enum
    // is pick-from-list only - the serializer rejects off-list values, so allowing typed entry would be a
    // dead end. allowCustom is therefore the field's own `enumOpen`.
    const allowCustom = $derived(row.enumOpen === true);
</script>

<Combobox {options} value={current} onchange={onedit} disabled={!row.editable}
          {allowCustom} ariaLabel={row.name} />
