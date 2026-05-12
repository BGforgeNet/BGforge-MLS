# Settings

([How to change settings in VScode](https://code.visualstudio.com/docs/getstarted/settings))

All settings are under the `bgforge` namespace.

## General

| Setting                             | Default       | Description                                                                                                                                                                                                     |
| ----------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bgforge.validate`                  | `saveAndType` | When validation runs: `manual` = only when invoked explicitly, `save` = on save, `type` = while editing, `saveAndType` = on both save and edit. `type`/`saveAndType` are disk-intensive and debounced at 300ms. |
| `bgforge.binaryEditor.autoDumpJson` | `false`       | Whether saving a file in the binary editor should also write a JSON snapshot next to it.                                                                                                                        |
| `bgforge.debug`                     | `false`       | Enable debug logging in the Output panel (BGforge MLS channel)                                                                                                                                                  |

## Fallout SSL

| Setting                                | Default                 | Description                                                                                                            |
| -------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `bgforge.falloutSSL.compilePath`       | `""`                    | Path to sslc compiler. Drop exe into system PATH and enter filename, or use full path. Empty = use built-in.           |
| `bgforge.falloutSSL.compileOptions`    | `-q -p -l -O2 -d -s -n` | Compiler flags                                                                                                         |
| `bgforge.falloutSSL.outputDirectory`   | `""`                    | Output directory for compiled scripts (default: next to source)                                                        |
| `bgforge.falloutSSL.headersDirectory`  | `""`                    | Additional headers directory (workspace is always scanned)                                                             |
| `bgforge.falloutSSL.compileOnValidate` | `true`                  | When enabled, validation on save/edit also writes the compiled `.int`. Disable to validate without overwriting output. |

## WeiDU

| Setting                  | Default | Description                                                       |
| ------------------------ | ------- | ----------------------------------------------------------------- |
| `bgforge.weidu.path`     | `weidu` | Path to WeiDU binary (or add to system PATH)                      |
| `bgforge.weidu.gamePath` | `""`    | Absolute path to IE game directory (needed for BAF/D diagnostics) |

## Lua

| Setting            | Default | Description                                                                                  |
| ------------------ | ------- | -------------------------------------------------------------------------------------------- |
| `bgforge.lua.path` | `luac`  | Path to Lua 5.2 compiler used for syntax validation (`luac -p`) for `.lua` and `.menu` files. Keep default if in PATH. |

### Install Official `luac` (Optional, for `bgforge.lua.path`)

If `luac` is already in your PATH, you can keep:

- `bgforge.lua.path = "luac"`

If not, install Lua from official source and either:

- set `bgforge.lua.path` to an absolute `luac` path, or
- add the install directory to your PATH and keep `bgforge.lua.path = "luac"`.

Official source releases: https://www.lua.org/ftp/

### Windows (PowerShell, official source build)

Requires MSYS2 / MinGW toolchain in shell PATH.

```powershell
cd $env:TEMP
curl.exe -LO https://www.lua.org/ftp/lua-5.2.4.tar.gz
tar -xzf lua-5.2.4.tar.gz
cd lua-5.2.4
mingw32-make mingw
```

`luac.exe` will be in `src\luac.exe`.

Clean up temporary build folder:

```powershell
cd $env:TEMP
Remove-Item -Recurse -Force lua-5.2.4
Remove-Item lua-5.2.4.tar.gz
```

Optional: add that folder to your user PATH:

```powershell
[Environment]::SetEnvironmentVariable(
	"Path",
	$env:Path + ";C:\path\to\lua-5.2.4\src",
	"User"
)
```

Restart terminal/VS Code after PATH changes.

### macOS (Terminal, official source build)

```bash
cd /tmp
curl -LO https://www.lua.org/ftp/lua-5.2.4.tar.gz
tar -xzf lua-5.2.4.tar.gz
cd lua-5.2.4
make macosx
sudo make INSTALL_TOP=/usr/local/lua-5.2.4 install
```

Clean up temporary build folder:

```bash
rm -rf /tmp/lua-5.2.4 /tmp/lua-5.2.4.tar.gz
```

Optional: add to PATH (zsh):

```bash
echo 'export PATH="/usr/local/lua-5.2.4/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### Linux (bash, official source build)

```bash
cd /tmp
curl -LO https://www.lua.org/ftp/lua-5.2.4.tar.gz
tar -xzf lua-5.2.4.tar.gz
cd lua-5.2.4
make linux
sudo make INSTALL_TOP=/usr/local/lua-5.2.4 install
```

Clean up temporary build folder:

```bash
rm -rf /tmp/lua-5.2.4 /tmp/lua-5.2.4.tar.gz
```

Optional: add to PATH:

```bash
echo 'export PATH="/usr/local/lua-5.2.4/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Verify

```bash
luac -v
```

If `luac` is not in PATH, set `bgforge.lua.path` to the absolute executable path.

## How to Pass Settings

Depends on the editor. See the editor-specific pages for examples:

- [Sublime Text](editors/sublime-text.md#settings) - `settings` in LSP client config
- [Neovim](editors/neovim.md#settings) - `settings` table in `vim.lsp.config`
- [Emacs](editors/emacs.md#settings) - `eglot-workspace-configuration` or lsp-mode
- [JetBrains](editors/jetbrains.md#settings) - LSP4IJ Configuration tab
- [Helix](editors/helix.md#settings) - `config` table in `languages.toml`
- [Zed](editors/zed.md#settings) - `settings` in `lsp` config
- [Geany](editors/geany.md#settings) - `initialization_options` in LSP Client config
- [Kate](editors/kate.md#settings) - `settings` in LSP client config (Kate 25.08+)
- [Notepad++](editors/notepadpp.md#settings) - `settings` in NppLspClient config
