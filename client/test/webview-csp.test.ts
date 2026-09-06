import * as fs from "fs";
import * as path from "path";
import { describe, expect, it, vi } from "vitest";
import { inlineWebviewScript } from "../src/webview-assets";
import { REPO_ROOT } from "./repo-root";

vi.mock("vscode", () => ({
    Uri: {
        joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
            toString: () => [base.fsPath, ...segments].join("/"),
            fsPath: [base.fsPath, ...segments].join("/"),
        }),
    },
}));

// The webview bundle is a build artifact this test must not depend on; everything it asserts is about the
// TEMPLATE, which is a source file. Only the script inlining is stubbed out.
vi.mock("../src/webview-assets", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/webview-assets")>()),
    getCachedJsAsset: () => "",
}));

const { SHARED_TILES_CSS, buildSharedWebviewHtml, sharedWebviewRoots } = await import("../src/webview-html");

/** A webview that resolves an extension URI to itself, so the produced HTML carries the repo-relative path. */
const fakeWebview = {
    cspSource: "vscode-webview:",
    asWebviewUri: (uri: { toString: () => string }) => uri,
} as unknown as import("vscode").Webview;

const extensionUri = { fsPath: REPO_ROOT } as unknown as import("vscode").Uri;

describe("webview script inlining", () => {
    it("inlines the script verbatim (no String.replace $-pattern expansion)", () => {
        // The minified production bundle contains `$&` (String.replace expands it to the matched placeholder text,
        // a syntax error that blanks the webview) alongside `$$` (collapses to `$`). The helper must inline verbatim
        // via a function replacement. `a$&2` and the `$$` identifiers below stand in for the real bundle's sequences.
        const html = '<script nonce="{{nonce}}">/* __SCRIPT__ */</script>';
        const script = "function f($$anchor,$$props){return $$props.x}var a$=1,b=a$&2;";
        const out = inlineWebviewScript(html, script, "NONCE-XYZ");
        expect(out).toContain(script); // verbatim inlining - the decisive property
        expect(out).not.toContain("/* __SCRIPT__ */");
        expect(out).toContain('nonce="NONCE-XYZ"');
    });

    it("inlines the real built binary-editor bundle without corrupting it", () => {
        // Exercise the real producer (the esbuild-svelte bundle), not only a hand-built fixture: a synthetic
        // script understates how many `$$` and which special sequences the real bundle actually carries.
        const built = path.join(REPO_ROOT, "client/out/binary-editor/webview/main.js");
        if (!fs.existsSync(built)) return; // build artifact absent in lint-only stages
        const html = fs.readFileSync(path.join(REPO_ROOT, "client/src/binary-editor/webview/index.html"), "utf8");
        const script = fs.readFileSync(built, "utf8");
        const before = (script.match(/\$\$/g) ?? []).length;
        expect(before).toBeGreaterThan(0); // sanity: the real bundle does contain `$$`
        const out = inlineWebviewScript(html, script, "n");
        expect((out.match(/\$\$/g) ?? []).length).toBe(before);
        expect(out).not.toContain("/* __SCRIPT__ */");
    });

    it("binary-editor bundle installs the fatal runtime-error handler", () => {
        // A webview that throws with no error hook leaves a silently blank panel and nothing in the output
        // channel. Guard that the hooks stay wired.
        const built = path.join(REPO_ROOT, "client/out/binary-editor/webview/main.js");
        if (!fs.existsSync(built)) return; // build artifact absent in lint-only stages
        const out = fs.readFileSync(built, "utf8");
        expect(out).toContain("runtimeError");
        expect(out).toContain("unhandledrejection");
    });

    it("dialog-editor bundle installs the fatal runtime-error handler (parity with the binary editor)", () => {
        const built = path.join(REPO_ROOT, "client/out/dialog-editor/webview/main.js");
        if (!fs.existsSync(built)) return; // build artifact absent in lint-only stages
        const out = fs.readFileSync(built, "utf8");
        expect(out).toContain("runtimeError");
        expect(out).toContain("unhandledrejection");
    });
});

describe("webview CSP", () => {
    it("binary editor loads styles via cspSource <link>, scripts via nonce (no unsafe-inline)", () => {
        const html = fs.readFileSync(path.join(REPO_ROOT, "client/src/binary-editor/webview/index.html"), "utf8");
        expect(html).not.toContain("'unsafe-inline'");
        expect(html).toContain("default-src 'none'");
        // Styles MUST be authorised via cspSource, NOT a bare nonce. VS Code's webview layer silently drops
        // a nonce-only `style-src` inline stylesheet, leaving the panel unstyled (raw Chromium honours it,
        // the wrapped VS Code webview does not). Regression guard: keep styles as cspSource-authorised links.
        expect(html).toContain("style-src {{cspSource}}");
        expect(html).not.toContain("style-src 'nonce-{{nonce}}'");
        expect(html).not.toContain("<style");
        expect(html).toContain('rel="stylesheet"');
        expect(html).toContain("script-src 'nonce-{{nonce}}'");
        expect(html).toContain('<script nonce="{{nonce}}">');
    });

    /**
     * The primitives shared across editors (webview-ui/) carry their theming in their OWN stylesheet, so every
     * panel mounting one links a SECOND sheet - through the same asWebviewUri placeholder, since a sheet the
     * provider forgets to map or to put under localResourceRoots is dropped exactly as silently as a
     * nonce-only one, and the primitive then renders as bare browser chrome inside an otherwise themed panel.
     *
     * Driven through the shared builder rather than read off the provider source: the three panels resolve
     * their chrome there, so an unmapped placeholder is a produced-HTML fact, not a spelling in one file.
     */
    it.each([
        ["binary editor", "client/src/binary-editor/webview", {}],
        ["animation editor", "client/src/image-editor/webview", { "{{sharedTilesUri}}": SHARED_TILES_CSS }],
        [
            "gallery",
            "client/src/gallery/webview",
            {
                "{{sharedTilesUri}}": SHARED_TILES_CSS,
                "{{animationStylesUri}}": path.join("client", "src", "image-editor", "webview", "styles.css"),
            },
        ],
    ])("%s resolves every stylesheet placeholder its template carries", (_name, dir, extraStyles) => {
        const template = fs.readFileSync(path.join(REPO_ROOT, dir, "index.html"), "utf8");
        expect(template).toContain('<link href="{{baseUri}}" rel="stylesheet" />');
        expect(template).toContain('<link href="{{primitivesUri}}" rel="stylesheet" />');

        const html = buildSharedWebviewHtml(fakeWebview, {
            cacheKey: `csp-test-${dir}`,
            extensionUri,
            html: path.join(dir, "index.html"),
            js: path.join(dir, "index.html"), // stubbed out above; never inspected
            css: path.join(dir, "styles.css"),
            extraStyles,
        });

        // The decisive property: nothing template-shaped survives into the panel. An unmapped `{{...}}` is
        // what a forgotten sheet looks like, and it renders as a dropped stylesheet rather than an error.
        expect(html).not.toMatch(/\{\{[a-zA-Z]+\}\}/);
        expect(html).toContain("client/src/webview-ui/base.css");
        expect(html).toContain("client/src/webview-ui/primitives.css");
        expect(html).toContain("client/out/codicons/codicon.css");
        expect(html).toContain(path.join(dir, "styles.css"));
        for (const sheet of Object.values(extraStyles)) expect(html).toContain(sheet);
    });

    /**
     * `asWebviewUri` only resolves a resource beneath a declared root, so a sheet outside one is dropped as
     * silently as a nonce-only style-src. Every sheet the builder maps must therefore fall under a root.
     */
    it("declares a root covering the codicon and shared-UI sheets", () => {
        const roots = sharedWebviewRoots(extensionUri, path.join("client", "src", "gallery", "webview")).map((uri) =>
            uri.toString(),
        );
        expect(roots).toEqual([
            `${REPO_ROOT}/client/out/codicons`,
            `${REPO_ROOT}/client/src/webview-ui`,
            `${REPO_ROOT}/client/src/gallery/webview`,
        ]);
    });

    it("binary editor CSP allows codicon font via cspSource", () => {
        const html = fs.readFileSync(path.join(REPO_ROOT, "client/src/binary-editor/webview/index.html"), "utf8");
        expect(html).toContain("font-src {{cspSource}}");
    });

    /**
     * Resref thumbnails are data URIs the host builds, and `default-src 'none'` blocks them QUIETLY - the
     * reserved box renders and the picture does not, which reads as a decode bug rather than a policy one.
     * Pinned narrowly: `data:` and no origin, since no image is ever loaded from the extension.
     */
    it("binary editor CSP allows thumbnail data URIs, and only those", () => {
        const html = fs.readFileSync(path.join(REPO_ROOT, "client/src/binary-editor/webview/index.html"), "utf8");
        expect(html).toContain("img-src data:");
        expect(html).not.toContain("img-src {{cspSource}}");
    });

    /**
     * The gallery is ALL thumbnails, so a missing `img-src data:` is not one empty box there but an entire
     * panel of them - and, as above, silently. It follows the same style/script policy as every other panel.
     */
    it("gallery CSP allows thumbnail data URIs and follows the shared style/script policy", () => {
        const html = fs.readFileSync(path.join(REPO_ROOT, "client/src/gallery/webview/index.html"), "utf8");
        expect(html).toContain("img-src data:");
        expect(html).toContain("default-src 'none'");
        expect(html).toContain("style-src {{cspSource}}");
        expect(html).not.toContain("style-src 'nonce-{{nonce}}'");
        expect(html).not.toContain("'unsafe-inline'");
        expect(html).toContain("script-src 'nonce-{{nonce}}'");
    });

    it("gallery bundle installs the fatal runtime-error handler", () => {
        const built = path.join(REPO_ROOT, "client/out/gallery/webview/main.js");
        if (!fs.existsSync(built)) return; // build artifact absent in lint-only stages
        const out = fs.readFileSync(built, "utf8");
        expect(out).toContain("runtimeError");
        expect(out).toContain("unhandledrejection");
    });

    /**
     * The harness renders the same components behind its own policy, so a laxer one there would false-green
     * exactly this class of bug: the picture draws in every screenshot and the shipped panel shows an empty box.
     * Only the directives that differ by construction (nonce vs cspSource for style/script) are exempt.
     */
    it("the render harness enforces the same img policy as the real panel", () => {
        const build = fs.readFileSync(path.join(REPO_ROOT, "binary-editor/test/harness/build.mts"), "utf8");
        expect(build).toContain("img-src data:");
        expect(build).toContain("default-src 'none'");
    });

    /**
     * A sheet the panel links and the harness omits is invisible to every assertion the harness makes about
     * CONTENT: the tiles still render, the labels still read, and only the LAYOUT is missing - so a check of
     * a computed grid or flex property reads the specified value back instead of the used one and reports a
     * number, not a failure. That is how the animation editor's grid ran unstyled here.
     *
     * Each marker is asserted present in its own sheet first, so a renamed selector fails as a stale marker
     * rather than as a missing stylesheet.
     */
    it.each([
        ["client/src/webview-ui/base.css", ".error-state"],
        ["client/src/webview-ui/primitives.css", ".bb-combobox"],
        ["client/src/webview-ui/animation-tiles.css", ".cycle-grid.fixed-columns"],
        ["client/src/image-editor/webview/styles.css", ".cycle-hint"],
    ])("the animation harness page carries %s, as the real panel links it", (sheet, marker) => {
        expect(fs.readFileSync(path.join(REPO_ROOT, sheet), "utf8")).toContain(marker);
        const page = path.join(REPO_ROOT, "binary-editor/test/harness/image-app.html");
        if (!fs.existsSync(page)) return; // harness not built in lint-only stages
        expect(fs.readFileSync(page, "utf8")).toContain(marker);
    });
});
