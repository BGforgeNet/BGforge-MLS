// SSL condition colouring in the dialog editor, verified in a real browser.
//
// The SSL fields colour through the TextMate grammar (vscode-textmate + vscode-oniguruma), not tree-sitter -
// see client/src/dialog-editor/webview/highlight/textmate.ts. Two things only hold together in a browser and
// are the reason this runs here rather than in a unit test: the field RE-RENDERS once the oniguruma wasm
// compiles and the grammar registers (main.ts kicks that off after mount, as production does), and the
// coloured <pre> lays text out exactly like the transparent textarea over it (a drift puts the caret off its
// glyphs, and it is invisible to a screenshot because the textarea's own text is transparent).
//
// The model is a real SSL parse (parseDialog + modelFromSSL), so the condition string is what the editor
// actually holds. As with the BAF driver, this does NOT cover the host's wrapped CSP - the harness page's
// policy is not enforced (see build.mts); that is the live drive's job, and it passed.
import { chromium } from "playwright";
import { parseDialog } from "../../../../../server/src/dialog";
import { modelFromSSL } from "../../../../../shared/dialog-model";
import { harnessPaths, makeChecker } from "./driver-util";

// A minimal SSL dialog with one conditional option, so the parse yields a real editable condition. The
// condition exercises the roles that must read as distinct colours: a builtin call, an all-caps constant, an
// operator, and a number.
const SRC = `procedure Node001 begin
   Reply(100);
   if (global_var(GVAR_TalkedToNPC) == 1) then begin
      NOption(101, Node002, 4);
   end
   NOption(102, Node003, 4);
end
procedure Node002 begin Reply(200); end
procedure Node003 begin Reply(300); end
procedure talk_p_proc begin call Node001; end
`;

const { appHtml } = harnessPaths(import.meta.url);
const { check, finish } = makeChecker();

const model = modelFromSSL(await parseDialog(SRC));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 460, height: 800 } });

const pageErrors: string[] = [];
const cspViolations: string[] = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => {
    const t = m.text();
    if (/Content Security Policy/i.test(t) || /Refused to/i.test(t)) cspViolations.push(t);
});

await page.goto("file://" + appHtml);
await page.evaluate((m) => window.postMessage({ type: "model", model: m }, "*"), model);
await page.waitForSelector('[role="treeitem"]', { timeout: 10_000 });

// Focus the conditional option so the Inspector shows its condition CodeField, then wait for the SSL
// tokenizer to land and paint spans.
await page.locator("[data-choice]").first().click();
await page.waitForSelector(".inspector .cf", { timeout: 5_000 });
await page
    .waitForFunction(() => document.querySelectorAll(".inspector .cf pre span[class]").length > 0, undefined, {
        timeout: 10_000,
    })
    .catch(() => undefined);

const hl = await page.evaluate(() => {
    // Inline only (no named fns): tsx/esbuild keepNames would inject an undefined __name in the page.
    let target: HTMLElement | undefined;
    for (const cf of Array.from(document.querySelectorAll<HTMLElement>(".inspector .cf"))) {
        const ta = cf.querySelector<HTMLTextAreaElement>("textarea");
        if (ta && ta.value.includes("global_var")) {
            target = cf;
            break;
        }
    }
    if (!target) return { found: false } as const;
    const roles: Record<string, string> = {};
    for (const s of Array.from(target.querySelectorAll<HTMLElement>("pre span[class]"))) {
        const role = s.className.split(" ").find((c) => c && !c.startsWith("svelte-"));
        if (role && !roles[role]) roles[role] = getComputedStyle(s).color;
    }
    const ta = target.querySelector<HTMLTextAreaElement>("textarea");
    const pre = target.querySelector<HTMLElement>("pre");
    return {
        found: true as const,
        value: ta?.value ?? "",
        roles,
        distinctColors: new Set(Object.values(roles)).size,
        taTransparent: ta ? getComputedStyle(ta).color === "rgba(0, 0, 0, 0)" : false,
        caretVisible: ta ? getComputedStyle(ta).caretColor !== "rgba(0, 0, 0, 0)" : false,
        sameFont: !!ta && !!pre && getComputedStyle(ta).font === getComputedStyle(pre).font,
    };
});

check(
    "SSL condition colours per token once the TextMate grammar loads, on a layer aligned to the textarea",
    hl.found &&
        // charts-blue: the builtin call. Asserting the exact hue proves the palette var resolves, not just
        // that spans exist - the whole point being editor-parity colour, not merely "something is highlighted".
        hl.roles["action"] === "rgb(89, 164, 249)" &&
        // The all-caps constant is coloured by CASING (the reason SSL uses TextMate) - not left plain.
        !!hl.roles["constant"] &&
        !!hl.roles["number"] &&
        !!hl.roles["keyword"] &&
        hl.distinctColors >= 3 &&
        hl.taTransparent &&
        hl.caretVisible &&
        hl.sameFont,
    JSON.stringify(hl),
);
check("no CSP violations", cspViolations.length === 0, cspViolations.join(" | "));

await browser.close();
finish(pageErrors);
