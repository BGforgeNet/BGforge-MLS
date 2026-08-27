# Binary editor

UI conventions for both layers, plus the reasoning behind them:
[docs/binary-editor-ui.md](../docs/binary-editor-ui.md). Per-layer rules:
`client/src/binary-editor/webview/AGENTS.md` (render), `binary/src/AGENTS.md` (schema).
Screenshot harness: `binary-editor/test/harness/README.md`.

## Reviewing a rendered screenshot

Render first - never reason about the cascade blind, and never fall back to a sketch without checking that a
driver exists.

**Do not flag the intentional patterns**: a roomy dropdown, a control narrower than its track, a
bare-vs-boxed flag difference, a folded Dice / Probability cell, mojibake in a raw-byte field, a lone-field
PRO panel, an effect with no semantic panel titles. Each is listed with its reason in the two rule files.

Harness artifacts that are also NOT defects: the large empty area at the bottom of some screenshots (the tall
capture viewport), `shot-primitives.png` being a raw-controls gallery rather than the dense field layout, and
minor softness from the reduced device scale.
