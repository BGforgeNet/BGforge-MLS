import { flushSync } from "svelte";
import { pickKvFit } from "./kv-fit-choice";

/**
 * Fits a multi-column key/value grid (`.kv-multi`) to its pane: the schema's column count is a MAXIMUM, and the
 * grid drops columns while any sized control would render narrower than its width class. Without it the grid's
 * `auto` value tracks shrink the controls instead (they carry `min-width:0; max-width:100%` so a too-narrow grid
 * never overlaps the next column), and a dropdown sized for its longest option clips its label.
 *
 * Each candidate count is rendered (`flushSync`) and measured inside one animation frame, widest first, so the
 * reader sees only the settled layout; `pickKvFit` decides between them. Stacked labels (`kv-stacked`) are for a
 * label and a wide dropdown side by side wider than the pane, and the shrink stays for a pane narrower still.
 */
export function fitKvColumns(
    node: HTMLElement,
    params: { max: number; set: (columns: number) => void; key: unknown },
): { update: (next: typeof params) => void; destroy: () => void } {
    let current = params;
    let pending = 0;

    // The class is the action's own: the components render a static class list, so a re-render never resets it.
    const renderAt = (columns: number, stacked = false): void => {
        node.classList.toggle("kv-stacked", stacked);
        flushSync(() => current.set(columns));
    };
    const fit = (): void => {
        let rendered = 0;
        const choice = pickKvFit(current.max, (columns) => {
            renderAt(columns);
            rendered = columns;
            return { holds: controlsHoldTheirWidth(node), besideSiblings: sharesLineWithSiblings(node) };
        });
        if (choice.stacked || choice.columns !== rendered) renderAt(choice.columns, choice.stacked);
    };
    const schedule = (): void => {
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(fit);
    };

    // The pane width, not the grid's own: the grid's width follows its column count, so observing it would
    // re-fit on every fit.
    const pane = node.closest<HTMLElement>(".layout-root") ?? document.body;
    const observer = new ResizeObserver(schedule);
    observer.observe(pane);
    schedule();

    return {
        // `set` is a fresh closure on every render (including the ones fit itself causes), so only the content key
        // and the cap decide whether to re-fit.
        update(next) {
            const changed = next.key !== current.key || next.max !== current.max;
            current = next;
            if (changed) schedule();
        },
        destroy() {
            cancelAnimationFrame(pending);
            observer.disconnect();
        },
    };
}

/** Whether the grid sits on one line with the other blocks of its panel (`.panel-blocks` wraps a block that does not
 *  fit beside it). A grid outside a panel row has no such siblings. */
function sharesLineWithSiblings(node: HTMLElement): boolean {
    const row = node.parentElement;
    if (!row?.classList.contains("panel-blocks")) return true;
    const top = node.offsetTop;
    return [...row.children].every((c) => (c as HTMLElement).offsetTop === top);
}

/** Whether every sized value control in the grid renders at the full width its class declares. */
function controlsHoldTheirWidth(node: HTMLElement): boolean {
    const controls = [
        ...node.querySelectorAll<HTMLElement>(
            ".field-control > input, .field-control .bb-combobox, .field-control > select",
        ),
    ];
    const rendered = controls.map((c) => c.getBoundingClientRect().width);
    // The control is squeezed by its flex wrapper and capped by max-width; lifting both shows the declared width.
    // Restored before returning, within the same frame.
    for (const c of controls) {
        c.style.flexShrink = "0";
        c.style.maxWidth = "none";
    }
    const declared = controls.map((c) => c.getBoundingClientRect().width);
    for (const c of controls) {
        c.style.removeProperty("flex-shrink");
        c.style.removeProperty("max-width");
    }
    return rendered.every((w, i) => w + 1 >= declared[i]!);
}
