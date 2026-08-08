/**
 * Resref resource-picker harness pass.
 *
 * A resref field renders as a searchable picker only when the record was opened from an installed game, so this
 * driver plays a host that HAS one: it runs outgoing messages through the real `withGameContext` (the same
 * stamping the extension does) with a synthetic game, and answers `requestResourceList` from a synthetic index.
 * The other drivers deliberately have no game, so this is the only pass that renders the control at all.
 *
 * What it pins:
 *   - a resref field becomes a combobox with a game, and stays a plain text input without one;
 *   - the list loads on FIRST OPEN, not on mount, and is fetched once per type however many fields share it;
 *   - the rendered-option cap reports its overflow rather than silently dropping it, and typing narrows;
 *   - a typed name the install does NOT have still commits - the picker is open-ended, which is the whole
 *     contract (a mod names what a later install step creates);
 *   - an icon field draws its BAM inline, at a box that does not change the row's height.
 */

import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// By path, like the client imports below: `@bgforge/image` is not a dependency of THIS package, and the
// harness reaches across the workspace rather than growing dependencies it only needs to build a fixture.
import { serializeBamV1 } from "../../../image/src/bam/serialize";
import { parseBamV1 } from "../../../image/src/bam/parse";
import { encodeIndexedPng } from "../../../image/src/png/encode";
import { transparentIndexOf, type Animation, type Rgba } from "../../../image/src/model/animation";
import { dispatch } from "../../src/index";
import type { HostToWebview, WebviewToHost } from "../../../client/src/binary-editor/webview/messages";
import { withGameContext } from "../../../client/src/binary-editor/game-rows";
import { installPageGate } from "./page-gate";
import { shotPath } from "./out-dir";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "../../../external/infinity-engine/bg2-wildmage/wildmage/wild_spells/itm/wm_sbook.itm");
const itmBytes = new Uint8Array(fs.readFileSync(FIXTURE));

/** The BAMs the synthetic install actually has, so those fields also get the open affordance. Two of them, with
 *  different prefixes so the filter assertion below still narrows to one: the viewability check needs a SECOND
 *  present name to change one variable at a time against the first. */
const PRESENT_BAM = "ISW1H01";
const PRESENT_BAM_2 = "XBOW01";
/** More BAMs than the combobox renders (cap 200), so the overflow notice is exercised - a real BG:EE has ~12300. */
const BAM_INDEX = [
    PRESENT_BAM,
    PRESENT_BAM_2,
    ...Array.from({ length: 260 }, (_, i) => `BAM${String(i).padStart(4, "0")}`),
].sort();

/** Types this synthetic host can DISPLAY. Mutable so one check can hold the value fixed and vary only this. */
let unviewable = new Set<string>();

/**
 * A real BAM for the install's icons - serialized, then decoded and re-encoded by the SAME host function the
 * extension calls, so this pass exercises the whole chain (BAM bytes -> decode -> PNG -> data URI -> CSP ->
 * `<img>`) rather than a hand-written data URI, which would prove only that an `<img>` renders.
 *
 * Magenta on index 1 over a transparent index 0: a colour no chrome in frame uses, so a pixel probe below can
 * tell the drawn icon from whatever it sits on.
 */
const ICON_EDGE = 32;
function iconBamBytes(): Uint8Array {
    const palette: Rgba[] = Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0, a: 255 }));
    palette[1] = { r: 255, g: 0, b: 255, a: 255 };
    const animation: Animation = {
        palette,
        frames: [
            {
                width: ICON_EDGE,
                height: ICON_EDGE,
                pixels: new Uint8Array(ICON_EDGE * ICON_EDGE).fill(1),
                offsetX: 0,
                offsetY: 0,
            },
        ],
        sequences: [{ frameRefs: [0], facing: "none" }],
        meta: { sourceFormat: "bam", transparentIndex: 0 },
    };
    return serializeBamV1(animation);
}
const ICON_BAM = iconBamBytes();

/**
 * The same decode-and-re-encode the host does, rather than a call to `thumbnailDataUri` itself: that module
 * lives in `client/`, a CommonJS package, and the ESM-only `@bgforge/image` it imports cannot be required from
 * one under tsx. So the FUNCTION is pinned by `client/test/ie-resources-thumbnails.test.ts`, where module
 * resolution works, and this pass pins what only a browser can answer - that the bytes reach an `<img>` past the
 * CSP, decode, and leave the row's height alone.
 */
function iconDataUri(): string {
    const animation = parseBamV1(ICON_BAM);
    const frame = animation.frames[0]!;
    const png = encodeIndexedPng(
        frame.width,
        frame.height,
        frame.pixels,
        animation.palette,
        transparentIndexOf(animation.meta),
    );
    let binary = "";
    for (const byte of png) binary += String.fromCharCode(byte);
    return `data:image/png;base64,${Buffer.from(binary, "binary").toString("base64")}`;
}

/** A game that resolves every declared type and holds only the present BAMs. */
const lookups = {
    strref: () => undefined,
    slotLabel: () => undefined,
    namingTable: () => undefined,
    resourceType: (decl: { type: string }, resref: string) => ({
        type: decl.type,
        present: decl.type === "BAM" && (resref === PRESENT_BAM || resref === PRESENT_BAM_2),
    }),
    // This driver plays a host with a game for the RESREF picker only; no kit-usability bit is in frame.
    flagBitNames: () => undefined,
    canOpen: (ext: string) => !unviewable.has(ext.toUpperCase()),
    canThumbnail: (ext: string) => ext.toUpperCase() === "BAM",
};

let sessionId = "";
const listRequests: string[] = [];
const thumbnailRequests: string[] = [];
const openRequests: string[] = [];
const edits: (number | string)[] = [];

function hostUp(m: WebviewToHost): HostToWebview[] {
    if (m.type === "ready") {
        const r = dispatch({ type: "open", uri: "file:///picker.itm", bytes: itmBytes });
        if (r.type !== "opened") return [];
        sessionId = r.result.sessionId;
        return [{ type: "init", open: r.result }];
    }
    if (m.type === "requestChildren") {
        const r = dispatch({ type: "getChildren", sessionId, nodeId: m.nodeId, start: m.start, end: m.end });
        return r.type === "children"
            ? [{ type: "children", requestId: m.requestId, parentId: r.parentId, rows: r.rows, total: r.total }]
            : [];
    }
    if (m.type === "requestResourceList") {
        listRequests.push(m.ext);
        return [
            {
                type: "resourceList",
                requestId: m.requestId,
                resrefs: m.ext.toLowerCase() === "bam" ? BAM_INDEX : [],
            },
        ];
    }
    if (m.type === "requestThumbnail") {
        thumbnailRequests.push(`${m.resref}.${m.ext}`);
        const isPresent = m.resref === PRESENT_BAM || m.resref === PRESENT_BAM_2;
        return [{ type: "thumbnail", requestId: m.requestId, dataUri: isPresent ? iconDataUri() : undefined }];
    }
    if (m.type === "openResource") {
        // The host would hand this to the ie-resources command; recording it is what proves the picture is
        // wired to the same action the chip performs, not merely styled as a control.
        openRequests.push(`${m.resref}.${m.ext}`);
        return [];
    }
    if (m.type === "editField") {
        edits.push(m.value);
        const r = dispatch({ type: "editField", sessionId, nodeId: m.nodeId, value: m.value });
        return r.type === "edited" ? [{ type: "changeSet", changeSet: r.result.changeSet, selection: m.nodeId }] : [];
    }
    return [];
}

const results: string[] = [];
function check(label: string, ok: boolean, detail: string): void {
    results.push(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
}

interface PickerShape {
    combobox: boolean;
    width: string;
    chip: boolean;
    /** The reserved thumbnail box, present from first paint whenever the host marked the row. */
    thumbBox: boolean;
    /** Whether that box is the open control - a real button - rather than an inert picture. */
    thumbLinked: boolean;
    /** The image's DECODED size. Zero means the browser rejected the data URI - a CSP block reads exactly so. */
    thumbNatural: string;
    /** Rounded so sub-pixel text metrics do not make an unchanged row look changed. */
    rowHeight: number;
}

/** Every resref field's rendered shape, keyed by its label. */
async function pickers(page: Page): Promise<Record<string, PickerShape>> {
    return page.evaluate(() => {
        const out: Record<string, PickerShape> = {};
        for (const field of Array.from(document.querySelectorAll(".layout-root .field"))) {
            const label = (field.querySelector(".label")?.textContent ?? "").trim();
            const control = field.querySelector(".field-control");
            if (!label || !control) continue;
            if (!/icon|replacement/i.test(label)) continue;
            const image = field.querySelector(".thumb img") as HTMLImageElement | null;
            out[label] = {
                combobox: control.querySelector(".bb-combobox-input") !== null,
                width: Array.from(control.classList).find((c) => c.startsWith("dd-") || c.startsWith("tier-")) ?? "?",
                chip: field.querySelector(".jump-link") !== null,
                thumbBox: field.querySelector(".thumb") !== null,
                thumbLinked: field.querySelector("button.thumb") !== null,
                thumbNatural: image === null ? "none" : `${image.naturalWidth}x${image.naturalHeight}`,
                rowHeight: Math.round(field.getBoundingClientRect().height),
            };
        }
        return out;
    });
}

// ---- Without a game: the same fields must stay plain text boxes ----
const browser = await chromium.launch({ headless: true });
const page: Page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const assertPageClean = installPageGate(page, "resource picker");

let gameOpen = false;
await page.exposeFunction("__hostUp", async (m: WebviewToHost) => {
    for (const reply of hostUp(m)) {
        const resolved = gameOpen ? withGameContext(reply, lookups) : reply;
        await page.evaluate((rr) => window.postMessage(rr, "*"), resolved);
    }
});
await page.goto("file://" + path.join(here, "app.html"));
await page.waitForSelector(".layout-root .panel h3", { timeout: 5000 });

const noGame = await pickers(page);
check(
    "no game: every resref field stays a plain text input",
    Object.keys(noGame).length > 0 && Object.values(noGame).every((f) => !f.combobox),
    JSON.stringify(noGame),
);

// ---- With a game: re-open the record so every row is stamped ----
gameOpen = true;
{
    const r = dispatch({ type: "open", uri: "file:///picker-game.itm", bytes: itmBytes });
    if (r.type !== "opened") throw new Error("re-open failed");
    sessionId = r.result.sessionId;
    await page.evaluate(
        (rr) => window.postMessage(rr, "*"),
        withGameContext({ type: "init", open: r.result } as HostToWebview, lookups),
    );
}
await page.waitForSelector(".layout-root .bb-combobox-input", { timeout: 5000 });

const withGame = await pickers(page);
const iconFields = Object.entries(withGame).filter(([label]) => /icon/i.test(label));
check(
    "game open: every resref field renders the searchable picker",
    iconFields.length >= 3 && iconFields.every(([, f]) => f.combobox),
    JSON.stringify(withGame),
);
check(
    "game open: a picker takes a dropdown width sized to the field's 8 chars (dd-2), not a text tier",
    iconFields.every(([, f]) => f.width === "dd-2"),
    JSON.stringify(iconFields.map(([l, f]) => `${l}=${f.width}`)),
);
// The fixture's own icons are not in this install, so nothing is openable yet while everything is pickable -
// the two affordances answer different questions. Proven the other way round after the edits below.
check(
    "game open: an unresolvable value is pickable but not openable",
    Object.values(withGame).every((f) => f.combobox && !f.chip),
    JSON.stringify(Object.entries(withGame).map(([l, f]) => `${l}: pick=${f.combobox} open=${f.chip}`)),
);
// A picture is withheld on the same terms as the chip, and for the same reason: the row is marked only when the
// game HAS the resource, so nothing is fetched and no empty box is reserved for a resref pointing at what a
// later install step creates.
check(
    "game open: an unresolvable value reserves no thumbnail box and fetches nothing",
    Object.values(withGame).every((f) => !f.thumbBox) && thumbnailRequests.length === 0,
    JSON.stringify(thumbnailRequests),
);
/** The row height with no picture in it - the baseline the thumbnail must not move. */
const heightBefore = withGame["Inventory Icon"]?.rowHeight ?? 0;

// ---- The list loads on first open, once per type ----
check("mount: no list is fetched before a picker is opened", listRequests.length === 0, JSON.stringify(listRequests));

const firstIcon = page.locator('.layout-root .bb-combobox-input[aria-label="Inventory Icon"]');

// The input shows the current value while idle, so a field the user only tabs through must not commit it back
// to itself - that reads as an edit downstream (dirty document, an undo slot) for a value nobody changed.
{
    const editsBefore = edits.length;
    await firstIcon.click();
    await page.waitForTimeout(300);
    await page.locator(".layout-root .panel h3").first().click();
    await page.waitForTimeout(500);
    check(
        "no-op: focusing and leaving a picker commits nothing",
        edits.length === editsBefore,
        `edits=${JSON.stringify(edits)}`,
    );
}
await firstIcon.click();
await page.waitForSelector(".bb-combobox-item", { timeout: 5000 });
check("open: opening a picker fetches its type's list", listRequests.length === 1, JSON.stringify(listRequests));

const opened = await page.evaluate(() => ({
    items: document.querySelectorAll(".bb-combobox-item").length,
    more: (document.querySelector(".bb-combobox-more")?.textContent ?? "").trim(),
}));
check(
    "open: the rendered list is capped and says how many it left out",
    opened.items === 200 && opened.more === `${BAM_INDEX.length - 200} more - keep typing to narrow`,
    `items=${opened.items} more="${opened.more}"`,
);

// Typing narrows to the matches - the point of the cap notice, and the only way to reach a late entry.
await firstIcon.fill("");
await firstIcon.pressSequentially(PRESENT_BAM.slice(0, 4), { delay: 10 });
await page
    .waitForFunction(() => document.querySelectorAll(".bb-combobox-item").length === 1, undefined, { timeout: 5000 })
    .catch(() => undefined);
const filtered = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".bb-combobox-item"), (e) => (e.textContent ?? "").trim()),
);
check(
    "filter: typing narrows the list to the match",
    JSON.stringify(filtered) === `["${PRESENT_BAM}"]`,
    JSON.stringify(filtered),
);

// ---- Open-ended: a name the install does not have still commits ----
await firstIcon.fill("");
await firstIcon.pressSequentially("MODONLY", { delay: 10 });
await firstIcon.press("Enter");
await page.waitForTimeout(300);
const committed = await page.evaluate(() => {
    const input = document.querySelector(
        '.layout-root .bb-combobox-input[aria-label="Inventory Icon"]',
    ) as HTMLInputElement | null;
    return input?.value ?? "";
});
check("open-ended: a resref the install does not have commits anyway", committed === "MODONLY", `input="${committed}"`);
check(
    "open-ended: committing an unresolvable name adds no marker and no open chip",
    (await pickers(page))["Inventory Icon"]?.chip === false,
    JSON.stringify((await pickers(page))["Inventory Icon"]),
);

// The other direction: picking a name the install DOES have grows the open chip, so the affordance tracks the
// value rather than the field - which is what makes withholding it on the miss above a statement about presence.
await firstIcon.fill("");
await firstIcon.pressSequentially(PRESENT_BAM, { delay: 10 });
await firstIcon.press("Enter");
await page
    .waitForFunction(
        () => {
            const field = document
                .querySelector('.layout-root .bb-combobox-input[aria-label="Inventory Icon"]')
                ?.closest(".field");
            return field?.querySelector(".jump-link") !== null;
        },
        undefined,
        { timeout: 5000 },
    )
    .catch(() => undefined);
// A BAM is drawable, so the affordance it grows is the PICTURE, not the chip: one control for one action, and
// the chip is suppressed for exactly these rows. A type with nothing to show keeps the chip - that is what the
// CRE script rows in `game-rows.test.ts` cover, since no undrawable type resolves in this fixture.
check(
    "presence: picking a resref the install has grows the open affordance, as the picture",
    (await pickers(page))["Inventory Icon"]?.thumbLinked === true &&
        (await pickers(page))["Inventory Icon"]?.chip === false,
    JSON.stringify((await pickers(page))["Inventory Icon"]),
);

// ---- The picture: drawn from the real BAM, and it does not move the row ----
await page
    .waitForFunction(
        () => (document.querySelector(".layout-root .thumb img") as HTMLImageElement | null)?.complete,
        undefined,
        { timeout: 5000 },
    )
    .catch(() => undefined);
{
    const row = (await pickers(page))["Inventory Icon"];
    // naturalWidth is the decisive part: it is the size Chromium got out of the PNG the host encoded, so a
    // blocked (CSP), truncated, or malformed data URI reads as 0x0 rather than passing as "an img exists".
    check(
        "thumbnail: a resolvable icon draws the BAM's own frame",
        row?.thumbNatural === `${ICON_EDGE}x${ICON_EDGE}`,
        JSON.stringify(row),
    );
    check(
        "thumbnail: fetched once, for the value actually shown",
        thumbnailRequests.length === 1 && thumbnailRequests[0] === `${PRESENT_BAM}.BAM`,
        JSON.stringify(thumbnailRequests),
    );
    // The constraint the feature was asked for: a picture appearing must not push the form around. Measured
    // against the SAME row before it had one, so nothing but the thumbnail (and its chip) differs.
    check(
        "thumbnail: the row is exactly as tall as it was without a picture",
        row !== undefined && heightBefore > 0 && row.rowHeight === heightBefore,
        `before=${heightBefore} after=${row?.rowHeight}`,
    );
    // The height check above compares one row against itself; this states the margin it is passing by, so a
    // size raised until it only just fits reads as a number here rather than as a still-green assertion.
    const box = await page.evaluate(() => {
        const field = document
            .querySelector('.layout-root .bb-combobox-input[aria-label="Inventory Icon"]')
            ?.closest(".field");
        return {
            thumb: Math.round(field?.querySelector(".thumb")?.getBoundingClientRect().height ?? 0),
            row: Math.round(field?.getBoundingClientRect().height ?? 0),
        };
    });
    check(
        "thumbnail: the box fits inside the row with room to spare",
        box.thumb > 0 && box.row - box.thumb >= 4,
        JSON.stringify(box),
    );

    // The decisive one for "the icon IS the link": clicking the picture must perform the same action the chip
    // did. A styled button that posts nothing would pass every check above.
    await page.click(".layout-root .field:has(button.thumb) button.thumb");
    await page.waitForTimeout(200);
    check(
        "thumbnail: clicking the picture opens the resource it shows",
        openRequests.length === 1 && openRequests[0] === `${PRESENT_BAM}.BAM`,
        JSON.stringify(openRequests),
    );
    // ...and it names itself, since an icon-only control has no visible text.
    const named = await page.evaluate(() => document.querySelector("button.thumb")?.getAttribute("aria-label") ?? "");
    check(
        "thumbnail: the picture-link carries its own name",
        named === `Open ${PRESENT_BAM}.bam`,
        `aria-label="${named}"`,
    );
}

// One variable apart from the check above: the value still resolves, only its type became undisplayable. The chip
// promises a VIEW, and `vscode.openWith`'s "default" is the plain text editor - a real CRE points at five BCS
// scripts and a DLG, none of which anything here reads. Picking is untouched: unviewable is not invalid.
unviewable = new Set(["BAM"]);
await firstIcon.fill("");
await firstIcon.pressSequentially(PRESENT_BAM_2, { delay: 10 });
await firstIcon.press("Enter");
await page.waitForTimeout(500);
{
    const row = (await pickers(page))["Inventory Icon"];
    check(
        "viewability: a value the install HAS is pickable but not openable when nothing can show its type",
        row?.combobox === true && row.chip === false,
        JSON.stringify(row),
    );
}
unviewable = new Set();

// A second picker of the same type reuses the fetched list rather than asking again.
const secondIcon = page.locator('.layout-root .bb-combobox-input[aria-label="Ground Icon"]');
await secondIcon.click();
await page.waitForSelector(".bb-combobox-item", { timeout: 5000 });
check(
    "cache: a second field of the same type reuses the list",
    listRequests.length === 1,
    JSON.stringify(listRequests),
);

await page.keyboard.press("Escape");
await page.screenshot({ path: shotPath("shot-resource-picker.png"), fullPage: true });

await browser.close();

console.log("\n=== resource picker harness results ===");
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed === 0 ? "\nALL RESOURCE PICKER ASSERTIONS PASS" : `\n${failed} RESOURCE PICKER ASSERTIONS FAILED`);
assertPageClean();
if (failed > 0) process.exit(1);
