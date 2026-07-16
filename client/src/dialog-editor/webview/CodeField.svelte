<!--
  A one-line-ish WeiDU BAF code field, syntax-coloured.

  Shape: a transparent <textarea> over a <pre> painting the same text in coloured runs. The textarea keeps
  every native behaviour (caret, selection, IME, undo, spellcheck-off) and the <pre> supplies the colour, so
  nothing here re-implements text editing.

  ALIGNMENT is the whole risk: the two layers must lay text out identically or the caret drifts from the
  glyphs under it. Three things guarantee it rather than hope for it:
    - both layers carry the same `.fld` rule (one declaration, not two that must be kept in step),
    - both wrap identically - `pre-wrap` + `break-word` is what a textarea's UA stylesheet already does, so
      the <pre> reproduces its line breaking instead of approximating it,
    - the height is driven by `autosize` on the textarea, and the <pre> is stretched to it, so neither layer
      ever scrolls. A scrolling layer would need its scrollTop mirrored on every keystroke; not scrolling at
      all removes the failure mode instead of managing it.

  Colours come from a palette this file owns, because a webview cannot read the active theme's TOKEN colours
  (microsoft/vscode#32813, open since 2017) - only its `--vscode-*` variables. So the aim is ROLE parity with
  the TextMate grammar (each role that reads differently in the editor reads differently here), not colour
  parity, which is unobtainable. Per-role rationale sits with the rules below.
-->
<script lang="ts">
    import { autosize } from "./autosize";
    import { toParts, tokenizeBaf, tokenizerReady, type BafFragmentKind } from "./highlight/tokenize";

    let {
        value,
        kind,
        disabled = false,
        title = "",
        placeholder = "",
        oninput,
    }: {
        value: string;
        /** Which synthetic context to parse in. A field holds a bare fragment, and the same call syntax is a
            trigger in a condition and an action in a THEN - so the caller must say which this field is. */
        kind: BafFragmentKind;
        disabled?: boolean;
        title?: string;
        placeholder?: string;
        oninput?: (value: string) => void;
    } = $props();

    // The webview mounts before the host can hand it the grammar wasm, so the tokenizer is never ready at
    // first paint. `tokenizeBaf` is a plain function Svelte cannot track, so this flag is what re-renders the
    // field once the wasm lands; without it the fields would stay flat forever in the live panel while every
    // unit test still passed. Until then - and permanently, if the wasm fails to load - the field renders as
    // one plain run: degraded and readable, never blank.
    let ready = $state(false);
    $effect(() => {
        void tokenizerReady().then(() => (ready = true));
    });

    const parts = $derived(ready ? toParts(value, tokenizeBaf(value, kind)) : [{ text: value }]);
</script>

<div class="cf">
    <!-- aria-hidden: this layer is a paint of the textarea's own value, so exposing it would make a screen
         reader announce the field's contents twice. The textarea remains the accessible control.
         Kept on one line: inside a <pre>, template indentation would render as literal text. -->
    <pre class="fld hl" aria-hidden="true">{#each parts as part}<span class={part.role}>{part.text}</span>{/each}</pre>
    <textarea
        class="fld ta"
        rows="1"
        spellcheck="false"
        autocapitalize="off"
        {disabled}
        {title}
        {placeholder}
        {value}
        use:autosize={value}
        oninput={(e) => oninput?.(e.currentTarget.value)}
    ></textarea>
</div>

<style>
    .cf {
        position: relative;
        /* The background lives here, not on either layer: the textarea must be transparent for the <pre>
           beneath to show through, and the <pre> must not paint over the textarea's dashed disabled border. */
        background: var(--vscode-input-background);
        border-radius: 4px;
    }
    /* The shared box. Both layers use this one rule, so their content boxes cannot drift apart - that is the
       point of it, not a coincidence. Mirrors Inspector's `.iv.code` so a BAF field sits flush with the
       plain fields around it; the values cannot be shared outright because Svelte scopes CSS per component. */
    .fld {
        width: 100%;
        box-sizing: border-box;
        margin: 0;
        border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
        border-radius: 4px;
        padding: 3px 6px;
        font-family: monospace;
        font-size: 10px;
        /* What a textarea's UA stylesheet already applies - matched here so the <pre> breaks lines in the
           same places. */
        white-space: pre-wrap;
        overflow-wrap: break-word;
    }
    .hl {
        position: absolute;
        inset: 0;
        /* Transparent, not absent: the border still has to occupy its 1px, or this layer's text box would be
           1px off from the textarea's on every side. The visible border is the textarea's. */
        border-color: transparent;
        background: transparent;
        /* Clicks belong to the textarea underneath; without this the field would not focus on click. */
        pointer-events: none;
        overflow: hidden;
        color: var(--vscode-input-foreground, var(--vscode-foreground));
    }
    .ta {
        position: relative;
        display: block;
        background: transparent;
        /* The glyphs come from the layer beneath; only the caret is drawn from here. */
        color: transparent;
        caret-color: var(--vscode-input-foreground, var(--vscode-foreground));
        resize: none;
        overflow: hidden;
    }
    .ta:disabled {
        /* Matches Inspector's `.iv:disabled`: a dashed border and the not-allowed cursor carry "read-only".
           The text is NOT dimmed - a read-only field still exists to be read, and it stays fully coloured. */
        cursor: not-allowed;
        border-style: dashed;
        border-color: var(--vscode-panel-border);
    }

    /* Palette. Chosen for role parity with bgforge-monokai's TextMate scopes, using the only solid
       foreground hues a webview is given (`--vscode-charts-*`, which the surrounding dialog UI already
       paints with). Each role that reads as its own colour in the editor reads as its own colour here.
       `charts-orange` is deliberately unused: it resolves to editor.findMatchHighlightBackground (#EA5C0055),
       a 33%-alpha BACKGROUND wash, so it is illegible as text. */
    .hl .keyword {
        /* monokai: keyword #F92672 */
        color: var(--vscode-charts-red);
    }
    .hl .trigger {
        /* monokai: entity.name.function #A6E22E */
        color: var(--vscode-charts-green);
    }
    .hl .action {
        /* monokai: support.function #66D9EF - the nearest hue available here is blue. */
        color: var(--vscode-charts-blue);
    }
    /* A constant and a number share a colour because they are the same thing wearing two spellings: an IDS
       value written as its name or as its number. monokai collapses them too (constant.other and
       constant.numeric are both #AE81FF). The roles stay distinct so a future palette can separate them. */
    .hl .constant,
    .hl .number {
        color: var(--vscode-charts-purple);
    }
    .hl .variable {
        /* monokai: variable.parameter #FD971F italic. No solid orange exists in the webview's palette, so
           the italic carries the distinction from a constant instead of the hue. */
        color: var(--vscode-charts-purple);
        font-style: italic;
    }
    .hl .string {
        /* monokai: string #E6DB74 */
        color: var(--vscode-charts-yellow);
    }
    .hl .comment {
        /* monokai: comment #88846f */
        color: var(--vscode-descriptionForeground);
    }
    /* Punctuation inherits. The TextMate grammar reddens ONLY an object specifier's brackets and dots and
       leaves a call's own parens plain, but the tree-sitter query captures every bracket alike and cannot
       tell the two apart - so colouring this role would redden call parens the editor leaves alone. Plain
       here is the closer match of the two. */
</style>
