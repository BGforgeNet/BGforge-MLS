// TypeScript-family (TD/TSSL) condition colouring in the dialog editor, verified in a real browser.
//
// The condition of a .td/.tssl dialog is TypeScript SOURCE (the model stores cond.getText()), not the
// transpiled D/SSL - so it colours through the minimal TypeScript-expression grammar
// (syntaxes/dialog-tsexpr.tmLanguage.yml), selected because the model's sourceLang is "tssl" (see Inspector
// condLang). This is the language the retired tree-sitter tokenizer could not cover at all. The condition here
// carries operators that are distinctly TypeScript - `&&` and a prefix `!` - so a pass proves the TS grammar is
// engaged, not a coincidental overlap with the SSL/BAF grammars.
//
// Same two browser-only guarantees as render-ssl: the field RE-RENDERS once the grammar registers (main.ts
// kicks that off after mount, as production does), and the coloured <pre> lays text out exactly like the
// transparent textarea over it. As with the SSL driver, this does NOT cover the host's wrapped CSP - the
// harness page's policy is not enforced (see build.mts); that is the live drive's job.
import { chromium } from "playwright";
import { parseTSSLSource } from "../../../../../server/src/tssl/dialog-source";
import { modelFromSSL } from "../../../../../shared/dialog-model";
import { harnessPaths, makeChecker } from "./driver-util";

// A minimal TSSL dialog with one conditional option, so the parse yields a real editable condition. The
// condition exercises the roles that must read as distinct colours through the TS grammar: two builtin calls,
// an all-caps constant, TypeScript operators (`==`, `&&`, `!`), and a number.
const SRC = `function Node001() {
    Reply(100);
    if (global_var(GVAR_X) == 1 && !is_dead(marcus)) {
        NOption(101, Node002, 4);
    }
}
function Node002() { Reply(200); NMessage(201); }
function talk_p_proc() { Node001(); }
`;

const { appHtml } = harnessPaths(import.meta.url);
const { check, finish } = makeChecker();

// modelFromSSL sets sourceLang "ssl"; a .tssl document is refined to "tssl" by the host (host-core.ts), which
// is what routes its conditions to the TypeScript grammar. Reproduce that refinement here.
const model = { ...modelFromSSL(parseTSSLSource(SRC)), sourceLang: "tssl" as const };

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

// Focus the conditional option so the Inspector shows its condition CodeField, then wait for the TS tokenizer
// to land and paint spans.
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
    "TS condition colours per token once the TextMate grammar loads, on a layer aligned to the textarea",
    hl.found &&
        // charts-green: a call reads as a trigger. Asserting the exact hue proves the palette var resolves, not
        // just that spans exist - the point being editor-parity colour, not merely "something is highlighted".
        hl.roles["trigger"] === "rgb(137, 209, 133)" &&
        // The all-caps constant is coloured; the TypeScript operators (&&, ==, !) read as keywords - the tokens
        // that distinguish this from the SSL/BAF grammars.
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
