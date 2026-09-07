<script lang="ts">
    import type { Row } from "@bgforge/binary-editor";
    import { rangeTooltip } from "../../state/controls";
    import { useGradientTable } from "../../state/gradient-table-context";
    const { row, onedit, compact = false }: {
        row: Row;
        onedit: (value: number) => void;
        // A fixed-width cell (the matrix) cannot hold a resolved strref's line - see CellControl.
        compact?: boolean;
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
    // Advisory range indication against the field's effective bounds (row.min/row.max, resolved host-side
    // in window.ts projectRow - storage-type range narrowed by any `domain:` declaration). This is purely
    // an indication: the editor faithfully stores whatever the file or user has, never clamping or
    // rejecting on write - the write-time zod gate (derive-zod.ts) is the sole save-blocking authority.
    // The out-of-range VISUAL is the browser's native input:out-of-range (styles.css), which the `min`/`max`
    // attributes below drive; it reflects the live typed value AND persists after a committed out-of-range
    // value, with no reflow. `bounds`/`outOfRange` here only feed the title hint and aria-invalid, derived
    // from the stored value. Skipped for hex32: its control edits the unsigned 32-bit bit pattern (see
    // commitHex), which does not line up with a signed type's row.min/row.max.
    const bounds = $derived(row.numericFormat === "hex32" ? undefined : rangeTooltip(row));
    const outOfRange = $derived(
        bounds !== undefined && row.min !== undefined && row.max !== undefined && (raw < row.min || raw > row.max),
    );
    const rangeTitle = $derived(bounds === undefined ? undefined : `Allowed range: ${bounds}`);

    // A strref whose dialog.tlk line the host resolved shows "<number> <line>" while idle, and just the number
    // while focused, so what you edit is exactly what is stored. One input across both states (rather than
    // swapping elements) keeps focus where the user put it; `text-overflow: ellipsis` in styles.css clips the
    // idle line, and the title carries it in full. Absent for a record outside a game, where nothing resolves.
    const strrefLine = $derived(compact ? undefined : row.strrefText);
    // In a compact cell the line still reaches the user, as the tooltip - it just does not widen the cell.
    const compactStrrefTitle = $derived(compact ? row.strrefText : undefined);
    let editing = $state(false);
    const strrefTitle = $derived(
        strrefLine === undefined ? rangeTitle : rangeTitle === undefined ? strrefLine : `${strrefLine}\n${rangeTitle}`,
    );
    function focusStrref(e: FocusEvent) {
        editing = true;
        const el = e.target as HTMLInputElement;
        el.value = String(raw);
        el.select();
    }
    function blurStrref(e: FocusEvent) {
        editing = false;
        (e.target as HTMLInputElement).value = strrefLine ?? "";
    }

    // The gradient picker. The table is the install's, not the record's, so it is fetched once per panel and
    // only when a picker is first opened - a record with no colour field never asks for it.
    const fetchGradients = useGradientTable();
    // Raw: the gradient table, fetched once and replaced wholesale.
    let gradients = $state.raw<readonly (readonly string[])[]>([]);
    let pickerOpen = $state(false);
    function togglePicker(): void {
        if (pickerOpen) {
            pickerOpen = false;
            return;
        }
        pickerOpen = true;
        if (gradients.length > 0 || !fetchGradients) return;
        fetchGradients().then(
            (table) => {
                gradients = table;
            },
            () => {
                // The field keeps its number and the picker shows its empty state; the failure itself reaches
                // the user through the bridge's own error channel.
                pickerOpen = false;
            },
        );
    }
    function choose(index: number): void {
        pickerOpen = false;
        if (index !== raw) onedit(index);
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
{:else if strrefLine !== undefined}
    <!-- Same wrapper shape as the hex field: a static span beside a borderless input, reading as one control.
         Here the span holds the strref itself, dimmed, so the dialog.tlk line is what the eye lands on. Focus
         hides the span (CSS) and swaps the input to the bare number, so what is edited is what is stored - one
         focusable element throughout, no element swap to juggle focus around. -->
    <span class="strref-input" class:disabled={!row.editable}>
        <span class="strref-num">{raw}</span>
        <input
            class="strref-line"
            type="text"
            inputmode="numeric"
            spellcheck="false"
            value={editing ? raw : strrefLine}
            disabled={!row.editable}
            title={strrefTitle}
            aria-invalid={outOfRange || undefined}
            onfocus={focusStrref}
            onblur={blurStrref}
            onchange={commitPlain}
        />
    </span>
{:else if row.gradientColors !== undefined}
    <!-- The number IS a gradient index, so the colours are the value and the digits alone say nothing. The
         strip is a fixed-width slot beside the input rather than a growable block, so a field that resolves
         and one that cannot (outside a game) occupy the same width and the column never reflows. -->
    <span class="gradient-input" class:disabled={!row.editable}>
        <input
            type="number"
            value={row.rawValue ?? ""}
            min={row.min}
            max={row.max}
            disabled={!row.editable}
            title={rangeTitle}
            aria-invalid={outOfRange || undefined}
            onchange={commitPlain}
        />
        <button
            type="button"
            class="gradient-swatch"
            disabled={!row.editable}
            title="Choose a colour"
            aria-label={`Choose a colour, currently gradient ${raw}`}
            aria-expanded={pickerOpen}
            onclick={togglePicker}
        >
            {#each row.gradientColors as color, i (i)}
                <span class="gradient-band" style:background-color={color}></span>
            {/each}
        </button>
        {#if pickerOpen}
            <!-- Absolutely positioned so opening it never reflows the form under it. -->
            <div class="gradient-picker" role="listbox" aria-label="Colour gradients" tabindex="-1">
                {#if gradients.length === 0}
                    <p class="gradient-empty">This game ships no colour table.</p>
                {:else}
                    {#each gradients as gradient, index (index)}
                        <button
                            type="button"
                            class="gradient-option"
                            class:selected={index === raw}
                            role="option"
                            aria-selected={index === raw}
                            onclick={() => choose(index)}
                        >
                            <span class="gradient-index">{index}</span>
                            <span class="gradient-strip">
                                {#each gradient as color, i (i)}
                                    <span class="gradient-band" style:background-color={color}></span>
                                {/each}
                            </span>
                        </button>
                    {/each}
                {/if}
            </div>
        {/if}
    </span>
{:else}
    <input
        type="number"
        value={row.rawValue ?? ""}
        min={row.min}
        max={row.max}
        disabled={!row.editable}
        title={compactStrrefTitle === undefined
            ? rangeTitle
            : rangeTitle === undefined
              ? compactStrrefTitle
              : `${compactStrrefTitle}\n${rangeTitle}`}
        aria-invalid={outOfRange || undefined}
        onchange={commitPlain}
    />
{/if}
