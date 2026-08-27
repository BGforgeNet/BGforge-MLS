/**
 * Primitives showcase + CSP gate (the bits-ui adoption de-risk).
 *
 * Builds the showcase bundle (Showcase.svelte -> Select + Combobox wrappers -> bits-ui) with esbuild-svelte,
 * writes a standalone HTML page that enforces the SAME strict CSP as the real binary-editor webview - with a
 * real nonce applied to the inlined <script> and <style> - then loads it in Chromium. It captures browser
 * console messages and page errors, renders the Select and Combobox, programmatically exercises each, and
 * asserts that NO CSP-violation message appeared. On success it prints PRIMITIVES CSP OK and the screenshot
 * path; on any CSP violation it prints the offending messages and exits non-zero.
 *
 * CSP de-risk result (bits-ui@2.15.0, esbuild-svelte@0.9.5 default css: "external"):
 *   - bits-ui's Select.Viewport and Combobox.Viewport ship component <style> blocks. With css: "external"
 *     (the production default) that CSS is emitted to a SEPARATE .css file the webview does not load, so NO
 *     non-nonced <style> element is injected -> no CSP violation. (With css: "injected" the same CSS would be
 *     injected as a non-nonced <style> at runtime and IS refused under style-src 'nonce-...' - do not use it.)
 *   - bits-ui's floating positioning (Content/Viewport) is applied via element.style.* CSSOM mutations, which
 *     CSP does not govern, plus a few static inline style= attributes that did not trip the policy.
 * Net: both primitives render AND open with zero CSP violations under the strict nonce CSP, provided the bundle
 * uses css: "external" (default) and the component CSS file stays unloaded - exactly the production shape. This
 * gate keeps that guarantee honest by failing if any CSP violation reappears.
 */
import { build } from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import { chromium } from "playwright";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installPageGate } from "./page-gate";
import { shotPath } from "./out-dir";
import { THEME_VARS } from "./theme-vars";

const here = path.dirname(fileURLToPath(import.meta.url));

// ---- Bundle the showcase (production-faithful: esbuild-svelte default css: "external"). ----
// Component <style> blocks (e.g. bits-ui's Viewport) are emitted to a SEPARATE .css file that the production
// binary-editor webview does NOT load - provider.ts inlines only styles.css + codicons into nonced <style>
// tags. We deliberately leave the emitted component CSS unloaded here to mirror that. External-css requires an
// on-disk output path, so we build to a temp dir (write: false errors on the fake-css import).
const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-primitives-"));
await build({
    entryPoints: [path.join(here, "showcase-main.ts")],
    bundle: true,
    format: "iife",
    write: true,
    outdir,
    logLevel: "info",
    plugins: [esbuildSvelte({ compilerOptions: { dev: true } })],
});
const js = fs.readFileSync(path.join(outdir, "showcase-main.js"), "utf8");
// The JS is now in memory; drop the temp build dir so repeated runs don't litter os.tmpdir().
fs.rmSync(outdir, { recursive: true, force: true });

const css = fs.readFileSync(path.join(here, "../../../client/src/binary-editor/webview/styles.css"), "utf8");

// VS Code Dark+ fallbacks for the --vscode-* vars styles.css consumes, loaded from the shared theme-vars
// module so adding a new variable only needs one harness update.
const showcaseExtras = `.showcase-root { padding: 1rem; }
.showcase-section { margin-bottom: 1.5rem; }
.showcase-label { font-weight: 600; margin-bottom: 0.4rem; }`;

// ---- Assemble the page with the REAL strict CSP and a real nonce on every nonced tag ----
const nonce = crypto.randomBytes(16).toString("base64");
const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; font-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
<style nonce="${nonce}">
${THEME_VARS}${showcaseExtras}
${css}
</style></head>
<body><div id="app"></div><script nonce="${nonce}">${js}</script></body></html>`;

const htmlPath = path.join(here, "showcase.html");
fs.writeFileSync(htmlPath, html);
console.log("wrote showcase.html (" + (html.length / 1024).toFixed(0) + " kb)");

// ---- Drive it under Chromium, capturing console + page errors ----
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 700, height: 600 } });
const assertPageClean = installPageGate(page, "PRIMITIVES");

await page.goto("file://" + htmlPath);

// ---- Exercise Combobox: type into the input (keydown opens the list), then filter ----
// bits-ui Combobox opens the listbox on the first keydown (non-modifier key) while closed. Playwright's
// pressSequentially fires real keydown/keypress/keyup events; fill() only sets the value without events.
await page.waitForSelector(".bb-combobox-input", { timeout: 5000 });
await page.locator(".bb-combobox-input").focus();
// Press a neutral key (ArrowDown) to open without changing the typed text.
await page.keyboard.press("ArrowDown");
await page.waitForSelector(".bb-combobox-content", { timeout: 5000 });
await page.waitForSelector(".bb-combobox-item", { timeout: 5000 });
const comboboxAllCount = await page.locator(".bb-combobox-item").count();

// Type a filtering query. Use pressSequentially so each keystroke triggers oninput, which bits-ui's
// SelectInputState picks up (setting inputValue.current) and our handleInput handler picks up (updating our
// local inputValue state, driving $derived visibleOptions). The dropdown is already open from ArrowDown.
await page.locator(".bb-combobox-input").pressSequentially("fireball");
// Wait for Svelte reactive updates to re-render the filtered list (item count drops below the unfiltered total).
await page
    .waitForFunction((all) => document.querySelectorAll(".bb-combobox-item").length < all, comboboxAllCount, {
        timeout: 5000,
    })
    .catch(() => undefined);
const comboboxFilteredCount = await page.locator(".bb-combobox-item").count();

// Close the combobox dropdown (still open from the filter step) before interacting with the Checkbox.
// Wait for the content to detach (bits-ui resets body.style.pointerEvents only after close animation).
await page.keyboard.press("Escape");
await page.waitForSelector(".bb-combobox-content", { state: "detached", timeout: 3000 }).catch(() => {});

// ---- Exercise Checkbox: click checkbox-a (unchecked -> checked) and assert data-state changes ----
// bits-ui sets data-state="checked"|"unchecked" on Checkbox.Root (role="checkbox"). We locate it inside
// the #checkbox-a wrapper (the showcase positions each in a named wrapper div for test targeting).
await page.waitForSelector("#checkbox-a [role='checkbox']", { timeout: 5000 });
const checkboxABefore = await page.locator("#checkbox-a [role='checkbox']").getAttribute("data-state");

await page.locator("#checkbox-a [role='checkbox']").click();
await page
    .waitForFunction(
        (before) => document.querySelector("#checkbox-a [role='checkbox']")?.getAttribute("data-state") !== before,
        checkboxABefore,
        { timeout: 5000 },
    )
    .catch(() => undefined);
const checkboxAAfter = await page.locator("#checkbox-a [role='checkbox']").getAttribute("data-state");

// Also confirm checkbox-b starts checked and can be untoggled.
const checkboxBBefore = await page.locator("#checkbox-b [role='checkbox']").getAttribute("data-state");
await page.locator("#checkbox-b [role='checkbox']").click();
await page
    .waitForFunction(
        (before) => document.querySelector("#checkbox-b [role='checkbox']")?.getAttribute("data-state") !== before,
        checkboxBBefore,
        { timeout: 5000 },
    )
    .catch(() => undefined);
const checkboxBAfter = await page.locator("#checkbox-b [role='checkbox']").getAttribute("data-state");

// Disabled checkbox must not change on click.
const checkboxDisabledBefore = await page.locator("#checkbox-disabled [role='checkbox']").getAttribute("data-state");
await page.locator("#checkbox-disabled [role='checkbox']").click({ force: true });
// No state-change event to poll for here: correct behavior is "nothing happens" on a disabled control, so there
// is no becomes-true condition to wait on. Keep a bounded settle so a real bug (an incorrect state flip) has
// time to land before the read below.
await page.waitForTimeout(100);
const checkboxDisabledAfter = await page.locator("#checkbox-disabled [role='checkbox']").getAttribute("data-state");

// Accessible name check: getByRole('checkbox', { name, exact }) resolves via the button's aria-label attribute.
// A label/for association does NOT name a <button>; the accessible name must come from aria-label.
// If the fix is absent (aria-label={undefined}), getByRole finds nothing and the counts below equal 0.
// exact: true avoids "Checked initially" matching "Unchecked initially" (substring match default).
const checkboxANamedCorrectly =
    (await page.getByRole("checkbox", { name: "Unchecked initially", exact: true }).count()) === 1;
const checkboxBNamedCorrectly =
    (await page.getByRole("checkbox", { name: "Checked initially", exact: true }).count()) === 1;
const checkboxDisabledNamedCorrectly =
    (await page.getByRole("checkbox", { name: "Disabled checkbox", exact: true }).count()) === 1;

// ---- Exercise Menu: click the trigger, assert items appear, click an enabled item, assert onselect ----
// bits-ui DropdownMenu renders the trigger as a <button> with the aria-label set on DropdownMenu.Trigger.
// Items render as role="menuitem". The harness has no codicon font so icon glyphs are empty, but that
// does not affect item label text or role - assert on labels and roles only, not icon visuals.
// Menu.svelte passes preventScroll={false} so it does not set body.style.pointerEvents:none (unlike the
// prior combobox). Ensure the combobox scroll-lock (if any) is cleared before clicking.
await page
    .waitForFunction(() => document.body.style.pointerEvents !== "none", undefined, { timeout: 500 })
    .catch(() => {});
await page.waitForSelector("#menu-showcase .bb-menu-trigger", { timeout: 5000 });
await page.locator("#menu-showcase .bb-menu-trigger").click();
// Wait for at least one menu item to appear (the content is portalled to document body).
await page.waitForSelector(".bb-menu-item", { timeout: 5000 });
const menuItemCount = await page.locator(".bb-menu-item").count();

// Locate and click "Add above" (enabled) to assert onselect fires with its id.
// Assert by label text (not icon) so missing codicon glyphs don't interfere.
const addAboveItem = page.locator(".bb-menu-item", { hasText: "Add above" });
await addAboveItem.click();
await page
    .waitForFunction(
        () => document.querySelector("#menu-selected")?.getAttribute("data-value") === "add-above",
        undefined,
        { timeout: 5000 },
    )
    .catch(() => undefined);
const menuSelectedAfterAdd = await page.locator("#menu-selected").getAttribute("data-value");

// Re-open the menu to test the disabled item. Menu.svelte uses preventScroll={false} so no scroll-lock
// to wait for; just wait for the content to detach after the previous click closed the menu.
await page.waitForSelector(".bb-menu-item", { state: "detached", timeout: 3000 }).catch(() => {});
await page.locator("#menu-showcase .bb-menu-trigger").click();
await page.waitForSelector(".bb-menu-item", { timeout: 5000 });
// Assert the disabled item is present in the DOM with data-disabled set.
const disabledItem = page.locator(".bb-menu-item[data-disabled]");
const disabledItemCount = await disabledItem.count();
// Click the disabled item - it must not fire onselect (the selected value must not change).
await disabledItem.click({ force: true });
// No state-change event to poll for here: correct behavior is "nothing happens" on a disabled item, so there
// is no becomes-true condition to wait on. Keep a bounded settle so a real bug (an incorrect onselect fire) has
// time to land before the read below.
await page.waitForTimeout(100);
const menuSelectedAfterDisabled = await page.locator("#menu-selected").getAttribute("data-value");

// Close the menu before the screenshot.
await page.keyboard.press("Escape");

// ---- Exercise Tabs (horizontal): assert initial active, click a different tab, assert selection moves ----
// The showcase reflects active tab id into #tabs-h-active[data-value] so we can assert without reading
// Svelte internals. Tabs render as role="tab" inside role="tablist" (#tabs-h-showcase).
await page.waitForSelector("#tabs-h-showcase [role='tablist']", { timeout: 5000 });
const tabsHInitial = await page.locator("#tabs-h-active").getAttribute("data-value");
// Click the "Abilities" tab (second tab, id="abilities").
const tabsHAbilities = page.locator("#tabs-h-showcase [role='tab'][aria-selected]", { hasText: "Abilities" });
await tabsHAbilities.click();
await page
    .waitForFunction(
        () => document.querySelector("#tabs-h-active")?.getAttribute("data-value") === "abilities",
        undefined,
        { timeout: 5000 },
    )
    .catch(() => undefined);
const tabsHAfterClick = await page.locator("#tabs-h-active").getAttribute("data-value");

// Arrow-key nav: with "Abilities" now active, press ArrowRight to move to "Effects".
await page.keyboard.press("ArrowRight");
await page
    .waitForFunction(
        () => document.querySelector("#tabs-h-active")?.getAttribute("data-value") === "effects",
        undefined,
        { timeout: 5000 },
    )
    .catch(() => undefined);
const tabsHAfterArrow = await page.locator("#tabs-h-active").getAttribute("data-value");

// ---- Exercise Tabs (vertical): assert initial active, click a different tab, assert selection moves ----
await page.waitForSelector("#tabs-v-showcase [role='tablist']", { timeout: 5000 });
const tabsVInitial = await page.locator("#tabs-v-active").getAttribute("data-value");
// Click the "Effects" tab (third tab, id="effects").
const tabsVEffects = page.locator("#tabs-v-showcase [role='tab']", { hasText: "Effects" });
await tabsVEffects.click();
await page
    .waitForFunction(
        () => document.querySelector("#tabs-v-active")?.getAttribute("data-value") === "effects",
        undefined,
        { timeout: 5000 },
    )
    .catch(() => undefined);
const tabsVAfterClick = await page.locator("#tabs-v-active").getAttribute("data-value");

// Arrow-key nav: with "Effects" now active, press ArrowUp to move to "Abilities" (vertical orientation).
await page.keyboard.press("ArrowUp");
await page
    .waitForFunction(
        () => document.querySelector("#tabs-v-active")?.getAttribute("data-value") === "abilities",
        undefined,
        { timeout: 5000 },
    )
    .catch(() => undefined);
const tabsVAfterArrow = await page.locator("#tabs-v-active").getAttribute("data-value");

// ---- Exercise compact RowActions: kebab-only layout + Menu->Delete fires immediately ----
// Compact mode (InlineList rows) must render ONLY the kebab dropdown, not the six icon buttons. Selecting
// "Delete" from the menu dispatches the remove structureOp immediately (removal is undoable, so there is no
// confirm step).
await page.waitForSelector("#rowactions-compact .bb-menu-trigger", { timeout: 5000 });
// Kebab-only: no labeled action buttons (Add above / Move up / Delete) render directly in compact mode.
const compactDirectButtons = await page
    .locator('#rowactions-compact button[aria-label="Move up"], #rowactions-compact button[aria-label="Add above"]')
    .count();
// Open the menu and pick Delete - this dispatches the remove immediately.
await page.locator("#rowactions-compact .bb-menu-trigger").click();
await page.waitForSelector(".bb-menu-item", { timeout: 5000 });
await page.locator(".bb-menu-item", { hasText: "Delete" }).click();
await page
    .waitForFunction(
        () =>
            (document.querySelector("#rowactions-last-op")?.getAttribute("data-value") ?? "").includes('"op":"remove"'),
        undefined,
        { timeout: 5000 },
    )
    .catch(() => undefined);
const opAfterMenuDelete = await page.locator("#rowactions-last-op").getAttribute("data-value");

await page.screenshot({ path: shotPath("shot-primitives.png") });

// Diagnostic: enumerate elements carrying a style attribute and any injected <style> tags.
const diag = await page.evaluate(() => {
    const styled = Array.from(document.querySelectorAll("[style]")).map((el) => ({
        tag: el.tagName.toLowerCase(),
        cls: el.getAttribute("class") ?? "",
        style: el.getAttribute("style") ?? "",
    }));
    const styleTags = Array.from(document.querySelectorAll("style")).map((el) => ({
        nonce: el.nonce || "(none)",
        head: (el.textContent ?? "").slice(0, 60),
    }));
    // Did the inline positioning style apply to CSSOM? Check the combobox floating wrapper.
    const floatWrap = document.querySelector(".bb-combobox-content")?.parentElement;
    const applied = floatWrap
        ? {
              position: getComputedStyle(floatWrap).position,
              transform: getComputedStyle(floatWrap).transform,
          }
        : null;
    return { styled, styleTags, applied };
});
console.log("\n[diag] elements with style= attribute:");
for (const s of diag.styled) console.log("  <" + s.tag + ' class="' + s.cls + '"> style="' + s.style + '"');
console.log("[diag] <style> tags present:");
for (const s of diag.styleTags) console.log("  nonce=" + s.nonce + " :: " + s.head);
console.log("[diag] combobox floating wrapper computed (did inline style apply?):", JSON.stringify(diag.applied));

await browser.close();

// ---- Assertions ----
// type-to-search: filtering "fireball" should reduce the visible item count below the total.
const typeToSearchWorks = comboboxFilteredCount < comboboxAllCount && comboboxFilteredCount > 0;

// Tabs (horizontal): initial active is "general"; clicking "Abilities" moves selection; arrow moves again.
const tabsHInitialCorrect = tabsHInitial === "general";
const tabsHClickWorks = tabsHAfterClick === "abilities";
const tabsHArrowWorks = tabsHAfterArrow === "effects";

// Tabs (vertical): initial active is "general"; clicking "Effects" moves selection; ArrowUp moves to "Abilities".
const tabsVInitialCorrect = tabsVInitial === "general";
const tabsVClickWorks = tabsVAfterClick === "effects";
const tabsVArrowWorks = tabsVAfterArrow === "abilities";

// Checkbox toggle: checkbox-a started unchecked; clicking it must flip to checked.
const checkboxAToggled = checkboxABefore === "unchecked" && checkboxAAfter === "checked";
// Checkbox toggle: checkbox-b started checked; clicking it must flip to unchecked.
const checkboxBToggled = checkboxBBefore === "checked" && checkboxBAfter === "unchecked";
// Disabled checkbox must not change state on click.
const checkboxDisabledUnchanged = checkboxDisabledBefore === checkboxDisabledAfter;

// Menu: items rendered, onselect fired with correct id, disabled item does not fire.
const menuItemsRendered = menuItemCount >= 5; // showcase has 5 items
const menuOnselectFired = menuSelectedAfterAdd === "add-above";
const menuDisabledItemPresent = disabledItemCount >= 1;
const menuDisabledNoFire = menuSelectedAfterDisabled === menuSelectedAfterAdd; // unchanged

// Compact RowActions: kebab-only (no direct labeled buttons); Menu Delete dispatches the remove immediately.
const compactIsKebabOnly = compactDirectButtons === 0;
const compactMenuDeleteFiresRemove = (opAfterMenuDelete ?? "").includes('"op":"remove"');

// ---- Verdict ----
console.log("\n=== Primitives CSP gate ===");
console.log(
    "Combobox: all items (unfiltered): " + comboboxAllCount + "; after 'fireball' filter: " + comboboxFilteredCount,
);
console.log("type-to-search works: " + typeToSearchWorks);
console.log(
    "Checkbox A toggle (unchecked -> checked): " + checkboxABefore + " -> " + checkboxAAfter + " : " + checkboxAToggled,
);
console.log(
    "Checkbox B toggle (checked -> unchecked): " + checkboxBBefore + " -> " + checkboxBAfter + " : " + checkboxBToggled,
);
console.log(
    "Checkbox disabled (unchanged): " +
        checkboxDisabledBefore +
        " -> " +
        checkboxDisabledAfter +
        " : " +
        checkboxDisabledUnchanged,
);
console.log("Checkbox A accessible name ('Unchecked initially'): " + checkboxANamedCorrectly);
console.log("Checkbox B accessible name ('Checked initially'): " + checkboxBNamedCorrectly);
console.log("Checkbox disabled accessible name ('Disabled checkbox'): " + checkboxDisabledNamedCorrectly);
console.log("Menu: items rendered (" + menuItemCount + " >= 5): " + menuItemsRendered);
console.log("Menu: onselect fired with 'add-above': " + menuOnselectFired + " (got: " + menuSelectedAfterAdd + ")");
console.log("Menu: disabled item present: " + menuDisabledItemPresent);
console.log("Menu: disabled item does not fire onselect: " + menuDisabledNoFire);
console.log("Tabs H: initial active=general: " + tabsHInitialCorrect + " (got: " + tabsHInitial + ")");
console.log("Tabs H: click Abilities moves selection: " + tabsHClickWorks + " (got: " + tabsHAfterClick + ")");
console.log("Tabs H: ArrowRight moves to Effects: " + tabsHArrowWorks + " (got: " + tabsHAfterArrow + ")");
console.log("Tabs V: initial active=general: " + tabsVInitialCorrect + " (got: " + tabsVInitial + ")");
console.log("Tabs V: click Effects moves selection: " + tabsVClickWorks + " (got: " + tabsVAfterClick + ")");
console.log("Tabs V: ArrowUp moves to Abilities: " + tabsVArrowWorks + " (got: " + tabsVAfterArrow + ")");
console.log("RowActions compact: kebab-only (no direct buttons): " + compactIsKebabOnly);
console.log("RowActions compact: Menu Delete dispatches remove immediately: " + compactMenuDeleteFiresRemove);
if (!compactIsKebabOnly) {
    console.log("\nROWACTIONS COMPACT KEBAB-ONLY FAILED: direct labeled buttons present, got " + compactDirectButtons);
    process.exit(1);
}
if (!compactMenuDeleteFiresRemove) {
    console.log(
        "\nROWACTIONS COMPACT MENU-DELETE FAILED: expected an immediate remove structureOp, got '" +
            opAfterMenuDelete +
            "'",
    );
    process.exit(1);
}
if (!typeToSearchWorks) {
    console.log(
        "\nTYPE-TO-SEARCH FAILED: filtered count (" +
            comboboxFilteredCount +
            ") should be < total (" +
            comboboxAllCount +
            ") and > 0",
    );
    process.exit(1);
}
if (!checkboxAToggled) {
    console.log(
        "\nCHECKBOX-A TOGGLE FAILED: expected unchecked -> checked, got " + checkboxABefore + " -> " + checkboxAAfter,
    );
    process.exit(1);
}
if (!checkboxBToggled) {
    console.log(
        "\nCHECKBOX-B TOGGLE FAILED: expected checked -> unchecked, got " + checkboxBBefore + " -> " + checkboxBAfter,
    );
    process.exit(1);
}
if (!checkboxDisabledUnchanged) {
    console.log(
        "\nCHECKBOX-DISABLED FAILED: state changed on click, got " +
            checkboxDisabledBefore +
            " -> " +
            checkboxDisabledAfter,
    );
    process.exit(1);
}
if (!checkboxANamedCorrectly || !checkboxBNamedCorrectly || !checkboxDisabledNamedCorrectly) {
    console.log(
        "\nCHECKBOX ACCESSIBLE NAME FAILED: expected getByRole('checkbox', { name }) to resolve for each " +
            "checkbox. A=" +
            checkboxANamedCorrectly +
            " B=" +
            checkboxBNamedCorrectly +
            " disabled=" +
            checkboxDisabledNamedCorrectly +
            ". The button's aria-label must equal the visible label text.",
    );
    process.exit(1);
}
if (!menuItemsRendered) {
    console.log("\nMENU ITEMS FAILED: expected >= 5 items, got " + menuItemCount);
    process.exit(1);
}
if (!menuOnselectFired) {
    console.log("\nMENU ONSELECT FAILED: expected 'add-above', got '" + menuSelectedAfterAdd + "'");
    process.exit(1);
}
if (!menuDisabledItemPresent) {
    console.log("\nMENU DISABLED ITEM FAILED: expected >= 1 item with data-disabled, got " + disabledItemCount);
    process.exit(1);
}
if (!menuDisabledNoFire) {
    console.log(
        "\nMENU DISABLED NO-FIRE FAILED: onselect changed after clicking disabled item " +
            "(before: '" +
            menuSelectedAfterAdd +
            "', after: '" +
            menuSelectedAfterDisabled +
            "')",
    );
    process.exit(1);
}
if (!tabsHInitialCorrect) {
    console.log("\nTABS-H INITIAL FAILED: expected 'general', got '" + tabsHInitial + "'");
    process.exit(1);
}
if (!tabsHClickWorks) {
    console.log("\nTABS-H CLICK FAILED: expected 'abilities', got '" + tabsHAfterClick + "'");
    process.exit(1);
}
if (!tabsHArrowWorks) {
    console.log("\nTABS-H ARROW FAILED: expected 'effects', got '" + tabsHAfterArrow + "'");
    process.exit(1);
}
if (!tabsVInitialCorrect) {
    console.log("\nTABS-V INITIAL FAILED: expected 'general', got '" + tabsVInitial + "'");
    process.exit(1);
}
if (!tabsVClickWorks) {
    console.log("\nTABS-V CLICK FAILED: expected 'effects', got '" + tabsVAfterClick + "'");
    process.exit(1);
}
if (!tabsVArrowWorks) {
    console.log("\nTABS-V ARROW FAILED: expected 'abilities', got '" + tabsVAfterArrow + "'");
    process.exit(1);
}
assertPageClean();
console.log("\nPRIMITIVES CSP OK");
console.log("screenshot: " + shotPath("shot-primitives.png"));
