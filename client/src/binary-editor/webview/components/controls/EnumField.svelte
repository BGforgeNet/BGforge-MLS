<script lang="ts">
    import type { Row } from "@bgforge/binary-editor";
    import { enumOptionList, parseCustomValue } from "../../state/controls";
    import Combobox from "../primitives/Combobox.svelte";

    const { row, onedit }: { row: Row; onedit: (value: number) => void } = $props();
    // The combobox is string-valued (bits-ui's own type), so an enum converts at this boundary - both ways,
    // since every value that comes back out of it is one of these option keys or a validated custom number.
    const options = $derived(enumOptionList(row).map((o) => ({ value: String(o.value), label: o.label })));
    const current = $derived(String(typeof row.rawValue === "number" ? row.rawValue : Number(row.rawValue)));

    // Every enum renders through the Combobox: substring search + a chevron on all dropdowns. An OPEN enum
    // (`enumOpen` - the advisory, mod-extensible tables) also lets the user type a custom numeric value, which
    // surfaces as "<n> Unknown" and round-trips (the codec accepts off-list values for these). A CLOSED enum
    // is pick-from-list only - the serializer rejects off-list values, so allowing typed entry would be a
    // dead end. allowCustom is therefore the field's own `enumOpen`.
    const allowCustom = $derived(row.enumOpen === true);

    /** Typed text is only a value if it parses as a plain decimal integer; anything else reverts the field. */
    function validateCustom(text: string): string | undefined {
        const parsed = parseCustomValue(text);
        return parsed === undefined ? undefined : String(parsed);
    }
</script>

<Combobox {options} value={current} onchange={(v) => onedit(Number(v))} disabled={!row.editable}
          {allowCustom} {validateCustom} ariaLabel={row.name} />
