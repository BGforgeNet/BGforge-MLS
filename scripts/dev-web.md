# `pnpm dev:web` - VS Code in the browser

`pnpm dev:web` (`scripts/dev-web.sh`) launches the extension inside [code-server](https://github.com/coder/code-server) -
VS Code running in a browser - so changes can be reviewed in the real editor without a desktop VS Code instance. Unlike
`vscode.dev`, code-server runs a full Node extension host, so the LSP server and the binary custom editor work.

It does three things:

1. **Bootstraps code-server.** On first run it downloads a pinned version into the gitignored `.dev/` directory and
   reuses it thereafter. code-server is intentionally **not** a repo dependency (same posture as the Playwright render
   harness); the only prerequisite is network access for that one-time download.
2. **Builds the extension** via `pnpm build:dev` (client + server + webviews). Pass `--no-build` to skip and just
   relaunch.
3. **Loads the repo as an unpacked extension** (symlinked under a dedicated `--extensions-dir`) and opens the workspace
   plus a small committed fixture, so the binary editor renders immediately.

Iterating is: edit, `pnpm build:dev`, then **Developer: Reload Window** in the browser - no VSIX repackaging.

## Launching

From the repo root:

```bash
pnpm dev:web              # build + (bootstrap on first run) + serve
pnpm dev:web --no-build   # relaunch without rebuilding
```

By default it serves plain HTTP on `0.0.0.0:8080`. Set `CODE_SERVER_PORT` / `CODE_SERVER_HOST` to bind elsewhere. The
command runs in the **foreground** - it is a long-lived server - so background it (or run it in a separate task) if you
need the shell back.

> **For automated agents:** this is the way to launch the extension for visual/manual review. Bind to the port your
> environment exposes (`CODE_SERVER_PORT=<port>`), run it in the background, and confirm it is up before reporting a
> URL. The binary editor is a webview, so the reviewer's browser must reach it over a **secure context** (see below) or
> the editor body renders blank.

## Access it over localhost (secure context required)

The binary editor is a VS Code **webview**, and webviews only work in a browser
[secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts). Over plain HTTP on a
non-localhost address the browser disables `crypto.subtle` (`'crypto.subtle' is not available so webviews will
not work`), and even a self-signed HTTPS cert fails because the browser rejects the webview's **service
worker** on an untrusted certificate (`Could not register service worker ... SSL certificate error`). In both
cases the file appears to open but the editor body is blank.

`http://localhost` counts as a secure context, so the default workflow is:

1. Start the server (it binds `0.0.0.0` over plain HTTP by default).
2. Forward the server's port to your machine's localhost (an SSH local forward, `ssh -L`, or your platform's
   port-forward).
3. Open the forwarded `http://localhost:<port>`. Webviews and the service worker work, no certificate involved.

If you instead reach the server directly at a non-localhost address, you need a genuinely **trusted** cert
(self-signed is not enough - the browser rejects the webview's service worker on it). Options: a reverse proxy
that terminates TLS with a trusted cert, or a locally-trusted cert (e.g.
[`mkcert`](https://github.com/FiloSottile/mkcert)) imported into your browser's trust store - then set
`CODE_SERVER_TLS=1` with `CODE_SERVER_CERT` / `CODE_SERVER_CERT_KEY`.

## Configuration

All optional, via environment:

| Variable               | Default                    | Purpose                                             |
| ---------------------- | -------------------------- | --------------------------------------------------- |
| `CODE_SERVER_HOST`     | `0.0.0.0`                  | Bind address                                        |
| `CODE_SERVER_PORT`     | `8080`                     | Bind port                                           |
| `CODE_SERVER_AUTH`     | `none`                     | `none` or `password`                                |
| `CODE_SERVER_TLS`      | `0`                        | `0` plain HTTP (use a localhost forward); `1` HTTPS |
| `CODE_SERVER_CERT`     | -                          | Path to a trusted TLS cert (with `TLS=1`)           |
| `CODE_SERVER_CERT_KEY` | -                          | Path to the certificate's private key               |
| `CODE_SERVER_VERSION`  | pinned in the script       | code-server version to download                     |
| `DEV_WEB_OPEN`         | a committed `.pro` fixture | File to open (set empty for workspace-only)         |

The install, the unpacked-extension symlink, and user data all stay under the gitignored `.dev/` directory.
