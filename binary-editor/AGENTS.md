# Binary editor

UI conventions for both layers, plus the reasoning behind them:
[docs/binary-editor-ui.md](../docs/binary-editor-ui.md). Per-layer rules:
`client/src/binary-editor/webview/AGENTS.md` (render), `binary/src/AGENTS.md` (schema).
Screenshot harness: `binary-editor/test/harness/README.md`.

## Reviewing a rendered screenshot

Render first - never reason about the cascade blind, and never fall back to a sketch without checking that a
driver exists.

What to check: [docs/binary-editor-ui.md](../docs/binary-editor-ui.md) (Reviewing a rendered screenshot).

**Do not flag the intentional patterns**: a roomy dropdown, a control narrower than its track, a grid showing
fewer columns than its schema declares, labels above their controls or a list above its detail in a narrow
editor, a bare-vs-boxed flag difference, a folded Dice / Probability cell,
mojibake in a raw-byte field, a lone-field PRO panel, an effect with no semantic panel titles. Each is explained
in that doc.

Harness artifacts that are also not defects: `binary-editor/test/harness/README.md` (Reading the screenshots).
