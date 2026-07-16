/**
 * VS Code Dark+ and Light+ fallback blocks for the dialog-editor harness.
 *
 * Every --vscode-* variable consumed by the dialog-editor webview's <style> blocks is defined here so
 * the harness renders the themed UI faithfully outside the real VS Code webview (which injects these
 * at runtime, keyed to the user's active color theme). Values are the VS Code default-theme registry
 * defaults (light/dark), sourced from microsoft/vscode's colorRegistry (colors/baseColors.ts,
 * editorColors.ts, listColors.ts, inputColors.ts, miscColors.ts, chartsColors.ts,
 * workbench/common/theme.ts) - not invented. A few colors VS Code derives at theme-apply time via
 * lighten()/darken() (button.hoverBackground, button.secondaryHoverBackground) are hand-approximated
 * here and marked as such.
 *
 * Mirrors binary-editor/test/harness/theme-vars.ts (same rationale, same shape); the dialog editor's
 * palette additionally needs the charts.* tokens (canvas/badge semantic hues) and the info/error
 * validation triads the binary editor's harness does not exercise.
 *
 * When adding a new var() call to the dialog-editor webview styles: add the corresponding Dark+ and
 * Light+ fallback here.
 */

/** CSS :root block defining every --vscode-* variable the harness needs (VS Code Dark+ defaults). */
export const DARK_THEME_VARS = `:root {
    --vscode-editor-font-family: "Droid Sans Mono", "monospace", monospace;
    --vscode-foreground: #cccccc;
    --vscode-descriptionForeground: rgba(204, 204, 204, 0.7);
    --vscode-errorForeground: #f48771;
    --vscode-editor-background: #1e1e1e;
    --vscode-panel-border: rgba(128, 128, 128, 0.35);
    --vscode-editorWidget-background: #252526;
    --vscode-editorGroupHeader-tabsBackground: #252526;
    --vscode-focusBorder: #007fd4;
    --vscode-textLink-foreground: #3794ff;
    --vscode-textLink-activeForeground: #3794ff;
    --vscode-input-background: #3c3c3c;
    --vscode-input-foreground: #cccccc;
    --vscode-list-hoverBackground: #2a2d2e;
    --vscode-list-activeSelectionBackground: #04395e;
    --vscode-list-activeSelectionForeground: #ffffff;
    --vscode-list-inactiveSelectionBackground: #37373d;
    --vscode-button-background: #0e639c;
    --vscode-button-foreground: #ffffff;
    --vscode-button-hoverBackground: #1177bb;
    --vscode-button-secondaryBackground: #2a2d2e;
    --vscode-button-secondaryForeground: #cccccc;
    --vscode-button-secondaryHoverBackground: #3e4142; /* approximate: VS Code derives lighten(secondaryBackground, 0.2) */
    --vscode-badge-background: #4d4d4d;
    --vscode-badge-foreground: #ffffff;
    --vscode-editorWarning-foreground: #cca700;
    --vscode-editorError-foreground: #f14c4c;
    --vscode-editorInfo-foreground: #59a4f9;
    --vscode-inputValidation-warningBackground: #352a05;
    --vscode-inputValidation-warningBorder: #b89500;
    --vscode-inputValidation-errorBackground: #5a1d1d;
    --vscode-inputValidation-errorBorder: #be1100;
    --vscode-inputValidation-infoBackground: #063b49;
    --vscode-inputValidation-infoBorder: #007acc;
    --vscode-charts-green: #89d185;
    --vscode-charts-purple: #b180d7;
    --vscode-charts-blue: #59a4f9;
    --vscode-charts-orange: #ea5c0055;
    /* charts.red/yellow are registered as aliases of editorError/editorWarning.foreground, so they repeat
       those values above rather than carrying hues of their own. */
    --vscode-charts-red: #f14c4c;
    --vscode-charts-yellow: #cca700;
}
`;

/** CSS :root block defining every --vscode-* variable the harness needs (VS Code Light+ defaults). */
export const LIGHT_THEME_VARS = `:root {
    --vscode-editor-font-family: "Droid Sans Mono", "monospace", monospace;
    --vscode-foreground: #616161;
    --vscode-descriptionForeground: #717171;
    --vscode-errorForeground: #a1260d;
    --vscode-editor-background: #ffffff;
    --vscode-panel-border: rgba(128, 128, 128, 0.35);
    --vscode-editorWidget-background: #f3f3f3;
    --vscode-editorGroupHeader-tabsBackground: #f3f3f3;
    --vscode-focusBorder: #0090f1;
    --vscode-textLink-foreground: #006ab1;
    --vscode-textLink-activeForeground: #006ab1;
    --vscode-input-background: #ffffff;
    --vscode-input-foreground: #616161;
    --vscode-list-hoverBackground: #f0f0f0;
    --vscode-list-activeSelectionBackground: #0060c0;
    --vscode-list-activeSelectionForeground: #ffffff;
    --vscode-list-inactiveSelectionBackground: #e4e6f1;
    --vscode-button-background: #007acc;
    --vscode-button-foreground: #ffffff;
    --vscode-button-hoverBackground: #005999; /* approximate: VS Code derives darken(buttonBackground, 0.2) */
    --vscode-button-secondaryBackground: #f0f0f0;
    --vscode-button-secondaryForeground: #616161;
    --vscode-button-secondaryHoverBackground: #f7f7f7; /* approximate: VS Code derives lighten(secondaryBackground, 0.2) */
    --vscode-badge-background: #c4c4c4;
    --vscode-badge-foreground: #333333;
    --vscode-editorWarning-foreground: #bf8803;
    --vscode-editorError-foreground: #e51400;
    --vscode-editorInfo-foreground: #0063d3;
    --vscode-inputValidation-warningBackground: #f6f5d2;
    --vscode-inputValidation-warningBorder: #b89500;
    --vscode-inputValidation-errorBackground: #f2dede;
    --vscode-inputValidation-errorBorder: #be1100;
    --vscode-inputValidation-infoBackground: #d6ecf2;
    --vscode-inputValidation-infoBorder: #007acc;
    --vscode-charts-green: #388a34;
    --vscode-charts-purple: #652d90;
    --vscode-charts-blue: #0063d3;
    --vscode-charts-orange: #ea5c0055;
    /* charts.red/yellow are registered as aliases of editorError/editorWarning.foreground, so they repeat
       those values above rather than carrying hues of their own. */
    --vscode-charts-red: #e51400;
    --vscode-charts-yellow: #bf8803;
}
`;
