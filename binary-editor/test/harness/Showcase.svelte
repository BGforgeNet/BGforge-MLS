<script lang="ts">
    // Showcase for primitives spike: renders Combobox, Checkbox, Menu, and Tabs wrappers so the Playwright
    // driver can exercise them under the real strict CSP and assert no CSP violation occurs. (Every enum is a
    // Combobox now - the plain Select primitive was retired, so it is no longer showcased.)
    import Combobox from "../../../client/src/binary-editor/webview/components/primitives/Combobox.svelte";
    import Checkbox from "../../../client/src/binary-editor/webview/components/primitives/Checkbox.svelte";
    import Menu from "../../../client/src/binary-editor/webview/components/primitives/Menu.svelte";
    import Tabs from "../../../client/src/binary-editor/webview/components/primitives/Tabs.svelte";
    import RowActions from "../../../client/src/binary-editor/webview/components/RowActions.svelte";
    import { Bridge } from "../../../client/src/binary-editor/webview/state/bridge";
    import type { WebviewToHost } from "../../../client/src/binary-editor/webview/messages";

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

    // Tabs showcase: horizontal and vertical, each with 3 tabs. Active is reflected via a data attr
    // so render-primitives.mts can assert selection changes without reading internal Svelte state.
    const tabsItems = [
        { id: "general", label: "General" },
        { id: "abilities", label: "Abilities" },
        { id: "effects", label: "Effects" },
    ];
    let tabsHActive = $state("general");
    let tabsVActive = $state("general");

    // Compact RowActions showcase: drives the InlineList (tight-row) layout, which is kebab-only. A real
    // Bridge records the last structureOp message so the driver can assert the Menu->Delete action dispatches
    // a remove immediately (delete is undoable, so there is no confirm step).
    let lastStructureOp = $state("");
    const showcaseBridge = new Bridge((m: WebviewToHost) => {
        if (m.type === "structureOp") lastStructureOp = JSON.stringify(m.op);
    });
    const rowActionsCaps = { insert: true, duplicate: true, up: true, down: true, remove: true };
</script>

<div class="showcase-root">
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
    <div class="showcase-section">
        <div class="showcase-label">Tabs (horizontal)</div>
        <!-- id used by render-primitives.mts to locate the tablist and assert tab selection changes -->
        <div id="tabs-h-showcase">
            <Tabs
                tabs={tabsItems}
                active={tabsHActive}
                orientation="horizontal"
                ariaLabel="Form sections"
                onselect={(id) => (tabsHActive = id)}
            />
        </div>
        <!-- Reflects active tab id so Playwright can assert the correct tab is selected. -->
        <div id="tabs-h-active" data-value={tabsHActive}></div>
    </div>
    <div class="showcase-section">
        <div class="showcase-label">Tabs (vertical)</div>
        <div id="tabs-v-showcase">
            <Tabs
                tabs={tabsItems}
                active={tabsVActive}
                orientation="vertical"
                ariaLabel="Form groups"
                onselect={(id) => (tabsVActive = id)}
            />
        </div>
        <!-- Reflects active tab id so Playwright can assert the correct tab is selected. -->
        <div id="tabs-v-active" data-value={tabsVActive}></div>
    </div>
    <div class="showcase-section">
        <div class="showcase-label">RowActions (compact / inline row)</div>
        <!-- id used by render-primitives.mts to scope queries to this compact RowActions instance. -->
        <div id="rowactions-compact">
            <RowActions
                acts={rowActionsCaps}
                entryId="0/1"
                bridge={showcaseBridge}
                compact={true}
            />
        </div>
        <!-- Reflects the last dispatched structureOp so Playwright can assert Menu->Delete fires remove immediately. -->
        <div id="rowactions-last-op" data-value={lastStructureOp}></div>
    </div>
</div>
