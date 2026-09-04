/**
 * Creature-palette picker driver: mounts the real animation-editor webview against an indexed BAM fixture
 * and drives the "Palette from" control - the shared searchable combobox (client/src/webview-ui) the binary
 * editor uses for every enum and resref field.
 *
 * What only a mounted drive can show: that the shared primitive's stylesheet reaches THIS panel (the panel
 * links webview-ui/primitives.css separately from its own), that the list is fetched on first open rather
 * than on mount, that the default filter offers only the creatures using the open animation, and that a pick
 * sends the host a setCreature. The list is synthetic - a real one needs an installed game.
 */
import { chromium, type Page } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CreatureOption, HostToWebview, WebviewToHost } from "../../../client/src/image-editor/webview/messages";
import { installPageGate } from "./page-gate";
import { shotPath } from "./out-dir";
import { buildBamFixture } from "./image-fixtures";
import { postHarnessWire, toHarnessWire } from "./image-wire";

const here = path.dirname(fileURLToPath(import.meta.url));
const view = buildBamFixture();

const CREATURES: CreatureOption[] = [
    { resref: "AGNASI", name: "Agnasia", matches: true },
    { resref: "DELAIN", name: "Delainy", matches: true },
    { resref: "ELMIN", name: "Elminster", matches: false },
    { resref: "NAMELESS", name: "", matches: false },
];

let creatureRequests = 0;
const chosen: (string | null)[] = [];

function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") return [{ type: "init", view }];
    if (m.type === "requestCreatures") {
        creatureRequests += 1;
        return [{ type: "creatures", entries: CREATURES }];
    }
    if (m.type === "setCreature") {
        chosen.push(m.resref);
        return [];
    }
    return [];
}

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

const browser = await chromium.launch({ headless: true });
const page: Page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const assertPageClean = installPageGate(page, "creature-palette");

await page.exposeFunction("__hostUpImage", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) {
        // eslint-disable-next-line no-await-in-loop -- replies must reach the page in order
        await page.evaluate(postHarnessWire, toHarnessWire(reply));
    }
});
await page.goto("file://" + path.join(here, "image-app.html"));
await page.waitForSelector(".cycle-grid canvas", { timeout: 5000 });

const picker = page.getByRole("combobox", { name: "Palette from" });
check("picker: the shared combobox mounts for an indexed animation", (await picker.count()) === 1, "");

// The shared primitives stylesheet is a SECOND link on this panel; without it the box has no chrome at all.
const boxed = await page.evaluate(() => {
    const box = document.querySelector(".creature-picker .bb-combobox");
    if (!box) return "no-box";
    const style = getComputedStyle(box);
    return `${style.position}/${style.borderBottomWidth}`;
});
check("picker: webview-ui/primitives.css reaches this panel", boxed === "relative/1px", `computed=${boxed}`);

check("picker: nothing is fetched before the list is opened", creatureRequests === 0, `requests=${creatureRequests}`);

const onlyMatching = page.getByRole("checkbox", { name: "Only this animation" });
check(
    "filter: 'only this animation' is on by default",
    (await onlyMatching.count()) === 1 && (await onlyMatching.isChecked()),
    "",
);

// The resting state is its own frame: an open list covers the rows below it, the checkbox among them.
await page.screenshot({ path: shotPath("shot-creature-palette-closed.png"), fullPage: true });

await picker.click();
await page.waitForSelector(".bb-combobox-item", { timeout: 3000 });
check("picker: opening the list fetches it once", creatureRequests === 1, `requests=${creatureRequests}`);

async function optionLabels(): Promise<string[]> {
    return page.evaluate(() =>
        Array.from(document.querySelectorAll(".bb-combobox-item"), (el) => el.textContent ?? ""),
    );
}
const filtered = await optionLabels();
check(
    "filter: only the creatures using this animation are offered, plus the placeholder",
    JSON.stringify(filtered) === JSON.stringify(["Placeholder colours", "Agnasia (AGNASI)", "Delainy (DELAIN)"]),
    JSON.stringify(filtered),
);

await page.keyboard.press("Escape");
await onlyMatching.click();
await picker.click();
await page.waitForSelector(".bb-combobox-item", { timeout: 3000 });
const all = await optionLabels();
check(
    "filter: unchecking widens the list to every creature, starring the matches",
    JSON.stringify(all) ===
        JSON.stringify([
            "Placeholder colours",
            "* Agnasia (AGNASI)",
            "* Delainy (DELAIN)",
            "Elminster (ELMIN)",
            "NAMELESS",
        ]),
    JSON.stringify(all),
);

// The search is the primitive's own - the control carries no second search field of its own.
await picker.fill("elmin");
await page.waitForFunction(() => document.querySelectorAll(".bb-combobox-item").length === 1, undefined, {
    timeout: 3000,
});
const searched = await optionLabels();
check(
    "search: typing filters the offered creatures",
    JSON.stringify(searched) === '["Elminster (ELMIN)"]',
    JSON.stringify(searched),
);

await page.screenshot({ path: shotPath("shot-creature-palette.png"), fullPage: true });

await page.locator(".bb-combobox-item").first().click();
await page.waitForFunction(() => true, undefined, { timeout: 1000 });
check(
    "pick: choosing a creature tells the host which one",
    JSON.stringify(chosen) === '["ELMIN"]',
    JSON.stringify(chosen),
);

await browser.close();

console.log("\n=== creature-palette render harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL CREATURE-PALETTE ASSERTIONS PASS" : `\n${failed} CREATURE-PALETTE ASSERTIONS FAILED`);
assertPageClean();
if (failed > 0) process.exit(1);
