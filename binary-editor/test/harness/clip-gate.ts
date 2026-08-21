/**
 * Shared value-control clipping gate for the headless harness drivers.
 *
 * A value control whose box is narrower than the text it shows clips that text - a sizing defect, never a
 * finished state (see binary-editor/AGENTS.md "Truncated text is a sizing defect"). This gate is
 * the format-agnostic net for that whole class: it does not care WHY a control is too narrow (a missing width
 * class, a too-small dd cap, a CSS regression), only that the rendered result clips.
 *
 * It runs two checks against the CURRENTLY rendered view (call it once per tab / view):
 *
 *  - clip: a visible value `<input>` (text/number input or the combobox's value input) whose `scrollWidth`
 *    exceeds its `clientWidth` is showing horizontally-clipped text. Catches a control that clips its CURRENT
 *    value, whatever the cause.
 *  - unsized: a rendered dropdown (`.bb-combobox`) with no `dd-{1..6}` width class on an ancestor box. Every
 *    dropdown is sized to its OWN longest option via that class (state/controls.ts `dropdownWidth`, applied in
 *    Field.svelte); a dropdown rendered through a path that never applies it (a grid/matrix cell via
 *    CellControl) carries none and will clip a long option even when its current value happens to be short -
 *    so this structural check fires regardless of the selected value, where the clip check alone would not.
 *
 * Usage (aggregate across views, report all, then fail once):
 *   const violations: ClipViolation[] = [];
 *   violations.push(...(await collectClipViolations(page, "CRE > Inventory")));
 *   ...
 *   reportClipViolations(violations, "CLIP SWEEP");  // logs all; exits non-zero if any
 */
import type { Page } from "playwright";

export interface ClipViolation {
    /** Which view this was found in, e.g. "CRE > Inventory". */
    context: string;
    /** "clip" = current value overflows its box; "unsized" = dropdown with no dd-* width class. */
    kind: "clip" | "unsized";
    /** Best-effort field label (the nearest `.nm` / `.field-label` text), for locating the control. */
    label: string;
    /** The text the control is displaying (the clipped value). */
    value: string;
    /** Rendered content width vs box width in px (clip only); 0/0 for unsized. */
    scrollWidth: number;
    clientWidth: number;
}

/**
 * Scan the current page render for clipped value controls and unsized dropdowns. Pure read - it never
 * interacts with the page, so it is safe to call after navigating to each tab/view.
 *
 * @param page - The Playwright page, already showing the view to check.
 * @param context - Short label for where this view is (e.g. "CRE > Inventory"), recorded on each violation.
 */
export async function collectClipViolations(page: Page, context: string): Promise<ClipViolation[]> {
    // NOTE: this callback is serialized into the browser by Playwright. tsx/esbuild `keepNames` wraps any
    // NAMED inner function with a `__name(...)` call that does not exist in the page, so the body uses only
    // anonymous inline arrows (array callbacks and IIFEs), never `const fn = () => ...` / `function`.
    const raw = await page.evaluate(() => {
        const out: {
            kind: "clip" | "unsized";
            label: string;
            value: string;
            scrollWidth: number;
            clientWidth: number;
        }[] = [];

        // --- clip: any visible value input whose content overflows its box ---
        for (const inp of Array.from(
            document.querySelectorAll<HTMLInputElement>(
                ".layout-root input[type='text'], .layout-root input[type='number'], .layout-root .bb-combobox-input",
            ),
        )) {
            // Visible = laid out (offsetParent set unless fixed) with a non-zero box.
            const r = inp.getBoundingClientRect();
            if (inp.offsetParent === null && getComputedStyle(inp).position !== "fixed") continue;
            if (r.width <= 0 || r.height <= 0) continue;
            // +1px tolerance for sub-pixel rounding; a genuine clip overflows by far more than a pixel.
            if (inp.scrollWidth > inp.clientWidth + 1) {
                out.push({
                    kind: "clip",
                    // Nearest human-readable label: grid/matrix cells use a sibling `.nm`, Field rows
                    // `.field-label`; walk up a few levels, else fall back to aria-label.
                    label: ((): string => {
                        let n: Element | null = inp;
                        for (let i = 0; i < 5 && n; i++) {
                            const nm = n.querySelector?.(".nm, .field-label, .label");
                            if (nm?.textContent) return nm.textContent.trim();
                            n = n.parentElement;
                        }
                        return inp.getAttribute("aria-label") ?? "";
                    })(),
                    value: inp.value,
                    scrollWidth: inp.scrollWidth,
                    clientWidth: inp.clientWidth,
                });
            }
        }

        // --- unsized: a rendered dropdown with no dd-* width class on any ancestor ---
        for (const cb of Array.from(document.querySelectorAll<HTMLElement>(".layout-root .bb-combobox"))) {
            const r = cb.getBoundingClientRect();
            if (cb.offsetParent === null && getComputedStyle(cb).position !== "fixed") continue;
            if (r.width <= 0 || r.height <= 0) continue;
            if (cb.closest(".dd-1, .dd-2, .dd-3, .dd-4, .dd-5, .dd-6")) continue;
            const inp = cb.querySelector<HTMLInputElement>(".bb-combobox-input");
            out.push({
                kind: "unsized",
                label: ((): string => {
                    let n: Element | null = cb;
                    for (let i = 0; i < 5 && n; i++) {
                        const nm = n.querySelector?.(".nm, .field-label, .label");
                        if (nm?.textContent) return nm.textContent.trim();
                        n = n.parentElement;
                    }
                    return cb.getAttribute("aria-label") ?? "";
                })(),
                value: inp?.value ?? "",
                scrollWidth: 0,
                clientWidth: 0,
            });
        }
        return out;
    });
    return raw.map((v) => ({ ...v, context }));
}

/**
 * Log every collected violation and exit non-zero if any were found; a no-op (with a clean line) otherwise.
 * Dedupes identical (context, kind, label, value) rows so a re-checked view does not double-count.
 *
 * @param violations - All violations aggregated across the run.
 * @param label - Short run label used in the summary line (e.g. "CLIP SWEEP").
 */
export function reportClipViolations(violations: ClipViolation[], label: string): void {
    const seen = new Set<string>();
    const unique = violations.filter((v) => {
        // Collapse the " (detail)" re-pass: a control that persists when a list row is selected (e.g. an
        // item-slots grid sharing the tab with a list) is the SAME defect in both passes, not two.
        const ctx = v.context.replace(/ \(detail\)$/, "");
        const key = `${ctx} ${v.kind} ${v.label} ${v.value}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    if (unique.length === 0) {
        console.log("CLIP: no clipped or unsized value controls");
        return;
    }
    console.log(`\n${unique.length} clipped / unsized value control(s) detected:`);
    for (const v of unique) {
        const size = v.kind === "clip" ? ` (scroll ${v.scrollWidth} > client ${v.clientWidth})` : "";
        console.log(`  [${v.kind}] ${v.context}  "${v.label}" = "${v.value}"${size}`);
    }
    console.log(`\n${label} FAILED`);
    process.exit(1);
}
