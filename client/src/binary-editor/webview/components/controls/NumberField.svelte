<script lang="ts">
    import type { Row } from "@bgforge/binary-editor";
    const { row, onedit, onlocalinvalid }: {
        row: Row;
        onedit: (value: number) => void;
        // Reports (or clears, with undefined) an advisory out-of-range message for the CURRENT input value,
        // so Field.svelte can show it through its existing diagnostic icon without waiting on the host
        // round trip. Optional: grid/matrix cells that render this control standalone need no diag icon.
        onlocalinvalid?: (message: string | undefined) => void;
    } = $props();
    // Width comes from the display-width tier (the tier class on the ancestor .field-control sets --val-ch in
    // CSS); this control just renders the value. Hex sits in the M tier ("0x" + 8 digits = 10 chars).
    // `hex32` is a display-only format: `rawValue` is the stored number, the control shows a 0x-prefixed hex
    // view, and commit parses the digits back before `onedit`, so the canonical bytes stay identical. Modulo
    // arithmetic (not bitwise) normalises to unsigned 32-bit and reads negative codecs (e.g. i32 PID) cleanly.
    const U32 = 0x100000000;
    const raw = $derived(typeof row.rawValue === "number" ? row.rawValue : Number(row.rawValue ?? 0));
    // Hex digits WITHOUT the "0x" - the prefix is a fixed, non-editable affordance in the markup, so the user
    // only ever edits the digits and cannot delete or corrupt the prefix.
    const hexDigits = $derived((((raw % U32) + U32) % U32).toString(16).padStart(8, "0"));
    // Basic input filtering only (strip characters that can't belong in the field); real range/format
    // validation is the (de)serializer's job, reported back as diagnostics.
    function filterHex(e: Event) {
        const el = e.target as HTMLInputElement;
        const cleaned = el.value.replaceAll(/[^0-9a-fA-F]/g, "");
        if (cleaned !== el.value) el.value = cleaned;
    }
    function commitHex(e: Event) {
        const v = parseInt((e.target as HTMLInputElement).value.trim() || "0", 16);
        if (Number.isFinite(v)) onedit(((v % U32) + U32) % U32);
    }
    function commitPlain(e: Event) {
        const v = Number((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) onedit(v);
    }
    // Advisory check against the field's effective bounds (row.min/row.max, resolved host-side in
    // window.ts projectRow - storage-type range narrowed by any domain declaration). Runs on every
    // keystroke of the plain decimal input so the message shows immediately, without waiting on the host
    // round trip; the write-time zod gate (derive-zod.ts) stays the sole save-blocking authority. Skipped
    // for hex32: its control edits the value's unsigned 32-bit bit pattern (see commitHex), which does not
    // line up with a signed type's row.min/row.max.
    function checkRange(v: number): void {
        if (row.numericFormat === "hex32" || row.min === undefined || row.max === undefined) return;
        onlocalinvalid?.(v < row.min || v > row.max ? `Value ${v} out of range (${row.min} to ${row.max})` : undefined);
    }
    function inputPlain(e: Event) {
        const v = Number((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) checkRange(v);
    }
</script>

{#if row.numericFormat === "hex32"}
    <!-- type=number can't render "0x..."; a text input with a static prefix gives an editable hex-digit field.
         Every value stays in this one control, including the -1 sentinel ("none"), which reads as 0xffffffff
         (all bits set) - consistent and recognizable, rather than morphing the control by sign. -->
    <span class="hex-input" class:disabled={!row.editable}>
        <span class="hex-prefix" aria-hidden="true">0x</span>
        <input
            class="hex-digits"
            type="text"
            inputmode="text"
            spellcheck="false"
            value={hexDigits}
            disabled={!row.editable}
            oninput={filterHex}
            onchange={commitHex}
        />
    </span>
{:else}
    <input
        type="number"
        value={row.rawValue ?? ""}
        min={row.min}
        max={row.max}
        disabled={!row.editable}
        oninput={inputPlain}
        onchange={commitPlain}
    />
{/if}
