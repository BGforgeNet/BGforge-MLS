<script lang="ts">
    // Showcase for primitives spike: renders Select, Combobox, Checkbox, and Menu wrappers so the
    // Playwright driver can exercise them under the real strict CSP and assert no CSP violation occurs.
    import Select from "../../../client/src/binary-editor/webview/components/primitives/Select.svelte";
    import Combobox from "../../../client/src/binary-editor/webview/components/primitives/Combobox.svelte";
    import Checkbox from "../../../client/src/binary-editor/webview/components/primitives/Checkbox.svelte";
    import Menu from "../../../client/src/binary-editor/webview/components/primitives/Menu.svelte";

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

    // Checkbox showcase state: one initially unchecked, one initially checked, one disabled.
    let checkboxA = $state(false);
    let checkboxB = $state(true);
    const checkboxDisabled = false; // disabled prop demo - value is fixed

    // Menu showcase: row-action items mimicking typical structure-op affordances.
    // One disabled item (separator is visual only; bits-ui Separator has no id).
    // One danger item (Delete). The selected id is reflected into #menu-selected for test assertion.
    const menuItems = [
        { id: "add-above", label: "Add above" },
        { id: "add-below", label: "Add below" },
        { id: "duplicate", label: "Duplicate" },
        { id: "delete", label: "Delete", danger: true },
        { id: "disabled-op", label: "Disabled op", disabled: true },
    ];
    let menuSelected = $state("");
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
    <div class="showcase-section">
        <div class="showcase-label">Checkbox</div>
        <!-- id used by render-primitives.mts to locate and toggle this checkbox -->
        <div id="checkbox-a">
            <Checkbox checked={checkboxA} label="Unchecked initially" onchange={(v) => (checkboxA = v)} />
        </div>
        <div id="checkbox-b">
            <Checkbox checked={checkboxB} label="Checked initially" onchange={(v) => (checkboxB = v)} />
        </div>
        <div id="checkbox-disabled">
            <Checkbox checked={false} label="Disabled checkbox" disabled={true} onchange={() => {}} />
        </div>
    </div>
    <div class="showcase-section">
        <div class="showcase-label">Menu (row action dropdown)</div>
        <!-- id used by render-primitives.mts to locate the menu trigger and assert item interactions -->
        <div id="menu-showcase">
            <Menu
                items={menuItems}
                ariaLabel="Row actions"
                onselect={(id) => (menuSelected = id)}
            />
        </div>
        <!-- Reflects the last selected menu item id so Playwright can assert onselect fired. -->
        <div id="menu-selected" data-value={menuSelected}></div>
    </div>
</div>
