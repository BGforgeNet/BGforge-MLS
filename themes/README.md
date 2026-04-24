`vscode-monokai.json` is taken from [VScode repo](https://github.com/microsoft/vscode/blob/main/extensions/theme-monokai/themes/monokai-color-theme.json) and only kept here for easier diffing and upstream update.

Same with `vs-seti-icon-theme.json`, sourced from [here](https://github.com/microsoft/vscode/tree/main/extensions/theme-seti).

## Upstream update procedure

1. Generate patch files (old upstream vs our customized version):
    ```
    diff -u themes/vscode-monokai.json themes/bgforge-monokai.json > themes/monokai.patch
    diff -u themes/vs-seti-icon-theme.json themes/bgforge-icon-theme.json > themes/seti.patch
    ```
2. Replace upstream copies with latest:
    ```
    curl -sL https://raw.githubusercontent.com/microsoft/vscode/main/extensions/theme-monokai/themes/monokai-color-theme.json -o themes/vscode-monokai.json
    curl -sL https://raw.githubusercontent.com/microsoft/vscode/main/extensions/theme-seti/icons/vs-seti-icon-theme.json -o themes/vs-seti-icon-theme.json
    ```
3. Copy new upstream to customized files, then apply patches:
    ```
    cp themes/vscode-monokai.json themes/bgforge-monokai.json
    cp themes/vs-seti-icon-theme.json themes/bgforge-icon-theme.json
    patch -p0 themes/bgforge-monokai.json themes/monokai.patch
    patch -p0 themes/bgforge-icon-theme.json themes/seti.patch
    ```
4. Remove patch files and verify: `diff themes/vscode-monokai.json themes/bgforge-monokai.json` should show only BGforge customizations.
