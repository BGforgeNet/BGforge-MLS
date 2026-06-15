/**
 * Canonical VS Code Dark+ fallback block for the binary-editor harness.
 *
 * Every --vscode-* variable consumed by styles.css is defined here so the harness renders the
 * themed UI faithfully outside the real VS Code webview (which injects these at runtime). A single
 * source prevents drivers from diverging when a new variable is added to styles.css.
 *
 * Variables deliberately excluded from styles.css but present here:
 *   --vscode-textLink-foreground: consumed by the Showcase/primitives driver (Select/Combobox hover).
 *
 * Variables NOT present here (confirmed not consumed by styles.css):
 *   --vscode-editor-foreground: not referenced anywhere in styles.css; excluded to avoid dead weight.
 *
 * When adding a new var() call to styles.css: add the corresponding Dark+ fallback here.
 */

/** CSS :root block defining every --vscode-* variable the harness needs, ending with a newline. */
export const THEME_VARS = `:root {
    --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Ubuntu", "Droid Sans", sans-serif;
    --vscode-font-size: 13px;
    --vscode-editor-font-family: "Droid Sans Mono", "monospace", monospace;
    --vscode-foreground: #cccccc;
    --vscode-editor-background: #1e1e1e;
    --vscode-descriptionForeground: #9d9d9d;
    --vscode-errorForeground: #f48771;
    --vscode-panel-border: #2b2b2b;
    --vscode-editorWidget-background: #252526;
    --vscode-focusBorder: #007fd4;
    --vscode-textLink-foreground: #3794ff;
    --vscode-input-background: #3c3c3c;
    --vscode-input-foreground: #cccccc;
    --vscode-input-border: #3c3c3c;
    --vscode-input-placeholderForeground: #a6a6a6;
    --vscode-list-hoverBackground: #2a2d2e;
    --vscode-list-activeSelectionBackground: #094771;
    --vscode-list-activeSelectionForeground: #ffffff;
    --vscode-button-background: #0e639c;
    --vscode-button-foreground: #ffffff;
    --vscode-button-hoverBackground: #1177bb;
    --vscode-button-border: transparent;
    --vscode-button-secondaryBackground: #3a3d41;
    --vscode-button-secondaryForeground: #ffffff;
    --vscode-button-secondaryHoverBackground: #45494e;
    --vscode-checkbox-background: #3c3c3c;
    --vscode-checkbox-foreground: #cccccc;
    --vscode-checkbox-border: #6b6b6b;
    --vscode-editorWarning-foreground: #cca700;
    --vscode-inputValidation-warningBackground: #352a05;
    --vscode-inputValidation-warningForeground: #cccccc;
    --vscode-inputValidation-warningBorder: #cca700;
}
`;
