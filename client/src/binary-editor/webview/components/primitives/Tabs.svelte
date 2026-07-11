<script lang="ts">
    // In-house accessible tablist strip. Renders the tab list only - NO content panels; the consumer
    // renders the active panel based on the `active` prop. bits-ui Tabs was evaluated and rejected for
    // strip-only use: its Root couples List+Trigger+Content state (valueToContentId, aria-controls wiring,
    // tabIndex effects tied to content registration), activationMode="automatic" fights controlled mode,
    // and there is no clean seam to use only the List+Trigger without the Content lifecycle. The standard
    // roving-tabindex + arrow-key pattern is small enough here (~25 lines) to be simpler than the coupling.
    //
    // A11y: role=tablist + aria-orientation + aria-label; each tab role=tab + aria-selected + roving tabindex
    // (active tab tabindex=0, others -1). Arrow keys move focus and select; Home/End jump to first/last.
    // NO component <style> block - theming lives entirely in styles.css (.bb-tabs.*) to stay CSP-safe under
    // the webview's strict nonce policy (non-nonced injected <style> tags are refused).

    import Icon from "../Icon.svelte";

    export interface TabItem {
        id: string;
        label: string;
        icon?: string;
        // Optional count badge shown after the label - a number (items in this tab) or a string (e.g. an "x/y"
        // pair). Rendered only when provided, so existing tab usages are unaffected. 0 is shown, not hidden.
        count?: number | string;
        // Greyed out and non-selectable (e.g. a MAP elevation absent per the header skip-flag). Skipped by
        // click and by arrow-key navigation.
        disabled?: boolean;
    }

    const {
        tabs,
        active,
        onselect,
        orientation = "horizontal",
        // variant controls visual weight: "primary" = prominent top section strip (heavier underline,
        // full-opacity, focusBorder accent); "secondary" = lighter in-form tabs (subdued, subordinate).
        // Default is "secondary" so existing in-form usages are unaffected without an explicit prop.
        variant = "secondary",
        ariaLabel,
    }: {
        tabs: TabItem[];
        active: string;
        onselect: (id: string) => void;
        orientation?: "horizontal" | "vertical";
        variant?: "primary" | "secondary";
        ariaLabel?: string;
    } = $props();

    function handleKeydown(event: KeyboardEvent): void {
        const activeIndex = tabs.findIndex((t) => t.id === active);
        if (activeIndex === -1) return;

        let nextIndex = -1;
        const prev = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
        const next = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";

        // Step over disabled tabs so arrow keys never land on a non-selectable tab.
        const step = (from: number, dir: 1 | -1): number => {
            for (let i = 1; i <= tabs.length; i++) {
                const j = (from + dir * i + tabs.length * i) % tabs.length;
                if (!tabs[j]?.disabled) return j;
            }
            return from;
        };
        const firstEnabled = (): number => tabs.findIndex((t) => !t.disabled);
        const lastEnabled = (): number => {
            for (let i = tabs.length - 1; i >= 0; i--) if (!tabs[i]?.disabled) return i;
            return -1;
        };

        if (event.key === prev) {
            nextIndex = step(activeIndex, -1);
        } else if (event.key === next) {
            nextIndex = step(activeIndex, 1);
        } else if (event.key === "Home") {
            nextIndex = firstEnabled();
        } else if (event.key === "End") {
            nextIndex = lastEnabled();
        } else {
            return;
        }

        event.preventDefault();
        const target = tabs[nextIndex];
        if (nextIndex < 0 || !target || target.disabled) return;
        onselect(target.id);
        // Move focus to the newly-selected tab. The keydown fires on the container div; currentTarget
        // is that div. querySelectorAll returns buttons in DOM order matching the tabs array order,
        // so nextIndex is stable. Programmatic focus works regardless of tabindex value.
        const container = event.currentTarget as HTMLDivElement;
        const buttons = container.querySelectorAll<HTMLButtonElement>("[role='tab']");
        buttons[nextIndex]?.focus();
    }
</script>

<!-- svelte-ignore a11y_interactive_supports_focus -->
<!-- WAI-ARIA does not require tabindex on the tablist container; the roving tabindex is correctly placed on
     the individual tab buttons (role=tab) below. Keyboard navigation is handled via onkeydown on this container. -->
<div
    class="bb-tabs {orientation} {variant}"
    role="tablist"
    aria-orientation={orientation}
    aria-label={ariaLabel}
    onkeydown={handleKeydown}
>
    {#each tabs as tab (tab.id)}
        {@const isActive = tab.id === active}
        <button
            role="tab"
            aria-selected={isActive}
            aria-disabled={tab.disabled ? "true" : undefined}
            tabindex={isActive && !tab.disabled ? 0 : -1}
            class:active={isActive}
            class:disabled={tab.disabled}
            disabled={tab.disabled}
            onclick={() => !tab.disabled && onselect(tab.id)}
        >
            {#if tab.icon}
                <Icon name={tab.icon} />
            {/if}
            {tab.label}
            {#if tab.count !== undefined}
                <span class="bb-tab-count">{tab.count}</span>
            {/if}
        </button>
    {/each}
</div>
