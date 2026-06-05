<script lang="ts">
    // Showcase for primitives spike: renders both Select and Combobox wrappers so the Playwright driver
    // can exercise them under the real strict CSP and assert no CSP violation occurs.
    import Select from "../../../client/src/binary-editor/webview/components/primitives/Select.svelte";
    import Combobox from "../../../client/src/binary-editor/webview/components/primitives/Combobox.svelte";

    const selectOptions = [
        { value: 0, label: "None" },
        { value: 1, label: "Fire" },
        { value: 2, label: "Cold" },
        { value: 3, label: "Lightning" },
    ];
    let selectCurrent = $state(1);

    // Large option list (>100 entries) to exercise type-to-search and scrolling. These mirror the shape
    // of IE opcode lists where hundreds of opcodes make a plain dropdown unusable.
    const comboboxOptions = Array.from({ length: 130 }, (_, i) => {
        const labels = [
            "AC Bonus",
            "Modify Attacks",
            "Damage Bonus",
            "Maximum HP Bonus",
            "Strength Bonus",
            "Dexterity Bonus",
            "Constitution Bonus",
            "Intelligence Bonus",
            "Wisdom Bonus",
            "Charisma Bonus",
            "Sleep",
            "Charm",
            "Fear",
            "Silence",
            "Blindness",
            "Haste",
            "Slow",
            "Cure Disease",
            "Dispel Magic",
            "Cure Poison",
            "Fire Damage",
            "Cold Damage",
            "Electricity Damage",
            "Acid Damage",
            "Magic Damage",
            "Missile Damage",
            "Fireball",
            "Lightning Bolt",
            "Ice Storm",
            "Acid Arrow",
        ];
        const base = labels[i % labels.length];
        const suffix = Math.floor(i / labels.length) > 0 ? ` (${Math.floor(i / labels.length)})` : "";
        return { value: i, label: base + suffix };
    });
    let comboboxCurrent = $state(20);
</script>

<div class="showcase-root">
    <div class="showcase-section">
        <div class="showcase-label">Select (plain dropdown)</div>
        <Select options={selectOptions} value={selectCurrent} ariaLabel="Element" onchange={(v) => (selectCurrent = v)} />
    </div>
    <div class="showcase-section">
        <div class="showcase-label">Combobox (searchable, 130 options)</div>
        <Combobox
            options={comboboxOptions}
            value={comboboxCurrent}
            ariaLabel="Effect opcode"
            placeholder="Search opcodes..."
            allowCustom={true}
            onchange={(v) => (comboboxCurrent = v)}
        />
    </div>
</div>
