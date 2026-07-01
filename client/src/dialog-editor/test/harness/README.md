# Dialog editor render harness

Headless Playwright harness that loads the **production** dialog-editor webview in Chromium.
e2e-tier: run out of process, **not** part of `pnpm test` / `pnpm test:all`.

## Why it mounts the real `App` (not `DialogGraph`)

`harness-main.ts` mounts the production root `App.svelte` and the driver delivers the model
through the real `window.postMessage` channel App listens on. App holds the model in a Svelte
`$state` proxy and passes that proxy down to `DialogGraph`. This is the live webview's exact
path - the `postMessage` boundary, the `$state` proxy, the message handshake, the loading /
error / timeout states, and the production-shaped CSP (nonce'd script, `style-src
'unsafe-inline'`).

An earlier version mounted `DialogGraph` directly with a raw object literal. That skipped every
one of those seams and rendered green while the live editor was stuck on "Parsing dialog..." -
three production-only bugs hid in the gap (external `<script src>` blanking the panel,
`structuredClone($state)` throwing `DataCloneError`, a silent hang). Do not revert to a
direct `DialogGraph` mount: the point of the harness is to exercise what production does.

## Run

```bash
# Rebuild app.html after any webview/Svelte change (bundles harness-main -> App):
pnpm exec tsx client/src/dialog-editor/test/harness/build.mts
# Drive the production path (posts the model, asserts render + a Duplicate edit + the
# error state; fails on any uncaught page error or CSP violation; writes the screenshot to repo tmp/):
pnpm exec tsx client/src/dialog-editor/test/harness/render.mts [out.png]
```

Prereqs are environmental, not repo deps: Playwright + a Chromium browser on `PATH`.

## Files

- `harness-main.ts` - mounts `App.svelte` (the production root).
- `build.mts` - bundles it to `app.html` with a production-shaped CSP.
- `render.mts` - the production-path driver (assertions + screenshot).
- `sample-model.ts` - a small hand-built `DialogModel` (also used by the unit tests).
- `real-model.ts` - frozen output of `modelFromD` on a real `.d` fixture; regenerate with
  `gen-real-model.ts` when the fixture or adapter changes.

The pure render-path logic (`modelToFlow`, `layoutFlow`) is unit-tested under `client/test/`
(`dialog-model-to-flow.test.ts`, `dialog-layout.test.ts`) and gates in `pnpm test`; this
harness covers the browser-only wiring those cannot reach.
