# Releasing

Releases are driven entirely by git tags pushed to GitHub Actions: the tag name selects what gets built and published, and pushing a tag is the only release trigger. This document is the canonical reference for the repository's tag scheme and the procedure for each release stream.

## Governing rule

The extension is the repository's primary product, so it uses the bare, GitHub-standard `vX.Y.Z` tag. Every other releasable artifact is a component and carries a name-prefixed tag, `<component>/vX.Y.Z`. Only the reusable Action additionally has a moving major alias, because Action consumers pin to a git ref; npm consumers pin a semver range, so the library packages do not need one.

## Tag forms

| Tag form                | Workflow              | Result                                                                                                                                                                    |
| ----------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vX.Y.Z`                | `build.yml`           | Builds the VSIX, publishes it to the VS Marketplace and Open VSX, publishes `@bgforge/mls-server` to npm, and creates the GitHub Release (with SBOM and SLSA provenance). |
| `binary/vX.Y.Z`         | `publish-library.yml` | Publishes `@bgforge/binary` to npm.                                                                                                                                       |
| `format/vX.Y.Z`         | `publish-library.yml` | Publishes `@bgforge/format` to npm.                                                                                                                                       |
| `transpile/vX.Y.Z`      | `publish-library.yml` | Publishes `@bgforge/transpile` to npm.                                                                                                                                    |
| `tssl/vX.Y.Z`           | `publish-library.yml` | Publishes `@bgforge/tssl` to npm.                                                                                                                                         |
| `actions/<name>/vX.Y.Z` | none                  | Immutable release ref for a reusable Action (`<name>` is `binary`, `format`, `transpile`, or `tssl`).                                                                     |
| `actions/<name>/v1`     | none                  | Moving major alias, re-pointed to the latest `actions/<name>/v1.x`.                                                                                                       |

`build.yml` filters its push trigger to `v[0-9]+.[0-9]+.[0-9]+`, and `publish-library.yml` to the four `<lib>/v...` patterns. Any tag matching neither - including every `actions/*` tag - starts no workflow. An Action needs none: it is consumed directly from its source at the pinned git ref, not built or published.

### Release assets

The `vX.Y.Z` release carries the VSIX, the SBOM, the editor bundles, and
`bgforge-mls-tree-sitter-grammars.zip` - the generated tree-sitter parsers, which are gitignored in the
repository and so cannot be built from a clone (see [grammars/README.md](../grammars/README.md)). All
of them are globbed into the release from `dist/`, and the same glob feeds the SLSA provenance subjects,
so a new `dist/*.zip` is covered by both without being listed again.

The grammar bundle is built on every push, not only on tags, so a non-tag build attaches it to the
`bgforge-mls-bundles` CI artifact beside the editor bundles and the SBOM - the same `dist/*.zip` glob,
retained 14 days. That is where an unreleased grammar fix is available from; releases remain the only
published channel.

## Pre-release checklist

Walk this before tagging a `vX.Y.Z` extension release. The detailed procedures are in the sections below; this is the preflight that catches what is easy to forget. The VSIX bundles every workspace package, so the extension itself ships regardless of the npm library versions - the items below mostly guard what npm and CLI consumers receive. Because the server now bundles its libraries, nothing forces a library or Action release alongside the extension: a component that changed since its own last tag must be released deliberately here, or it ships stale to its own consumers while the extension moves on.

- [ ] **Upstream data refreshed.** Pull the latest engine data so the release ships current definitions: run `pnpm update-data`, which refreshes Infinity Engine BAF actions/triggers from IESDP (`ie-update`) and Fallout SSL data from sfall (`fallout-update`), then regenerates the derived data and recompiles the TextMate JSON. Review the resulting diff under `server/data/` and `syntaxes/`; any user-visible additions or changes belong in the changelog below. Separately, check for a newer **sslc** compiler release (`sfall-team/sslc`): if one exists, bump the `sslc-emscripten-noderawfs` tarball URL in `server/package.json` and refresh its `pnpm-lock.yaml` integrity (evolve the lockfile incrementally - see `docs/dependencies.md`).
- [ ] **Version bumped past the last tag.** `package.json` and `server/package.json` carry the same new version, and it is greater than the most recent `vX.Y.Z` tag - re-tagging the current version is a no-op. Confirm with `node -p "require('./package.json').version"`, `node -p "require('./server/package.json').version"`, and `git tag --list 'v*' --sort=-v:refname | head -1`.
- [ ] **Changelog finalized.** Rename the `## Unreleased` heading in `docs/changelog.md` to the new version, and confirm every user-facing change since the last tag is listed - features, bug fixes, and behavior changes alike (`git log --oneline <last-tag>..HEAD` for the source set). Implementation-only commits (refactors, tests, CI, build) stay out.
- [ ] **Independently-versioned libraries checked.** `@bgforge/binary`, `@bgforge/format`, `@bgforge/transpile`, and `@bgforge/tssl` version on their own tags. Their source is bundled into the server bundle and the VSIX, so the extension ships regardless of their npm state and they release in any order; their npm packages and CLIs (`fgbin`, `fgfmt`, `fgtp`, `tssl`) update only when you tag them. If `binary/src`, `format/src`, `transpilers/src`, or `compilers/tssl/src` carries unreleased changes you want on npm (`npm view @bgforge/<pkg> version` vs the `package.json`), bump and tag each (`binary/vX.Y.Z`, `format/vX.Y.Z`, `transpile/vX.Y.Z`, `tssl/vX.Y.Z`) - see _Releasing a library_ below.
- [ ] **Reusable Actions checked.** `actions/binary`, `actions/format`, `actions/transpile`, and `actions/tssl` are consumed at a pinned git ref, so a consumer on `actions/<name>/v1` sees a change to the ACTION only when you move that alias. Cut a new `actions/<name>/vX.Y.Z` and re-point `actions/<name>/v1` when `actions/**` has changed since that action's last tag - its own `action.yml` or the shared `actions/_shared/` scripts. A CLI change alone is NOT a reason: each action installs its CLI from npm (`npm install -g @bgforge/<pkg>@${{ inputs.version }}`, defaulting to `latest`) rather than building the repo at the pinned ref, so a consumer picks up a new `fgbin`/`fgfmt`/`fgtp`/`tssl` the moment the library is PUBLISHED, and re-tagging the action would ship nothing. Publish the library instead (the item above); the action tag tracks the action. See _Releasing a reusable Action_ below.
- [ ] **Security advisories cleared.** Run `pnpm audit`, and review the repository's open **Dependabot security alerts** (Security tab - version-update Dependabot is off by policy, but security alerts stay enabled in Settings -> Code security) and the **CodeQL** / **OpenSSF Scorecard** code-scanning findings. A new high-severity advisory is a release blocker, not a note-for-later: resolve each before tagging - bump the dependency, add a `pnpm` override pin, or, when the vulnerable path is genuinely unreachable, dismiss it with a recorded rationale (the `uuid` precedent). See [dependencies.md](dependencies.md) and [supply-chain.md](supply-chain.md).
- [ ] **Pins and overrides still necessary.** Each version pin and override is a workaround for a specific upstream state, not a permanent fixture. Walk `docs/dependencies.md` (the LSP `vscode-languageclient`/`-server`/`-protocol` triplet, `ts-morph`/`typescript`, `@types/node`, `ini`, `sslc-...`) and the `overrides` + `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`. For each deliberate hold, check whether its "revisit when X" trigger is now met (a matured major shipped, an advisory closed, an upstream patched its bundled dep so the override is redundant); for each override, test removing it (`pnpm install` + the gate) and keep only the minimal set still required. Drop what is no longer needed and keep the recorded rationale current for what stays.
- [ ] **Full gate green.** `pnpm build:all && pnpm test:all` passes (the cross-subsystem close-out gate) - run it last, on the final tree, after any library bump, security fix, or override drop above.
- [ ] **Commit, tag, push.** Commit the version bump and changelog as `Update changelog, bump version: X.Y.Z`, then tag `vX.Y.Z` and push the tag.

## Releasing the extension (`vX.Y.Z`)

Root `package.json` and `server/package.json` must carry identical versions; they ship together as the VSIX and the `@bgforge/mls-server` npm package (check the current value with `node -p "require('./package.json').version"`).

1. Bump the version in both `package.json` and `server/package.json`.
2. Update `docs/changelog.md` with the user-facing changes.
3. Commit as `Update changelog, bump version: X.Y.Z`.
4. Tag `vX.Y.Z` and push the tag.

The extension and the libraries release in any order - the server bundles its libraries rather than depending on their npm versions (see _The server and VSIX bundle their libraries_ below).

## Releasing a library (`binary` / `format` / `transpile` / `tssl`)

The four library packages version independently of the extension and of each other. Each library and its bundled CLI (`fgbin`, `fgfmt`, `fgtp`, `tssl`) share one `package.json`, so a library and its CLI always move together. Workspace consumers (`server/`, `client/`) reference the packages via `workspace:*`, so bumping a library version does not require updating dependents.

1. Bump the version in the library's `package.json` (`binary/package.json`, `format/package.json`, `transpilers/package.json` for `@bgforge/transpile`, or `compilers/tssl/package.json`).
2. Add a `## X.Y.Z` section to the library's `CHANGELOG.md` covering its consumer-facing changes since the last tag - the CLI, parser/serializer output, and public API. Editor UI changes belong in the extension changelog (`docs/changelog.md`), not here. Each library's `CHANGELOG.md` is in its `files` allowlist, so it ships in the npm tarball.
3. Commit.
4. Tag `<lib>/vX.Y.Z`, matching the new version exactly, and push the tag.

`publish-library.yml` resolves the tag prefix to the package, verifies the tag version matches the package's `package.json`, runs the package's build and tests, then publishes to npm with provenance. How that publish authenticates - and how a package moves to trusted publishing - is described in _npm authentication_ below.

### The server and VSIX bundle their libraries (no release ordering)

Neither the published `@bgforge/mls-server` nor the VSIX declares an `@bgforge/*` package as a runtime dependency. The server bundles `@bgforge/format` and the transpilers into `server/out/server.js`, and the VSIX bundles `@bgforge/binary` and `@bgforge/binary-editor` into the client bundle (the build externalizes only `vscode` and `rolldown`); `@bgforge/format` is a `devDependency` of `server/`, consumed at build time. So a fresh `npm install @bgforge/mls-server` resolves no `@bgforge/*` packages, and the extension and the libraries can release in any order. A library bump is needed only to publish that library's own npm package and CLI for external consumers.

## npm authentication (tokens and trusted publishing)

Two workflows publish to npm: `publish-library.yml` (the four libraries, on `<lib>/vX.Y.Z` tags) and
`build.yml` (`@bgforge/mls-server`, on the extension's `vX.Y.Z` tag). Both authenticate with the `NPM_TOKEN`
repository secret, passed to the publish step as `NODE_AUTH_TOKEN`, and both jobs carry `id-token: write` so
the publish can attest SLSA provenance.

### The first publish of a new package name

A trusted publisher can only be configured on a package that already exists on npm, so a brand-new package
name cannot start on OIDC - its first publish has to go through `NPM_TOKEN`. Two things bite only on a first
publish:

- The token must be allowed to CREATE a package. A granular access token restricted to an explicit package
  allowlist publishes the existing packages happily and still fails on a new name; scope it to the `@bgforge`
  scope, or use an automation token, before tagging.
- The package must be published public. `scripts/publish-lib.sh` passes `--access public` and each manifest
  sets `publishConfig.access`; a scoped package would otherwise be rejected as private.

### Migrating a package to trusted publishing

Trusted publishing is configured per package on npmjs.com, naming this repository and the workflow that
publishes it (`publish-library.yml` for a library, `build.yml` for the server). It can be adopted one package
at a time, and switching one over needs no workflow change: npm attempts the OIDC exchange before it reads
any configured credentials, and on success replaces the auth token for that request. So a package publishes
over OIDC from the moment its trusted publisher exists, while the rest keep using the token.

Both version floors are already met here: npm 11.5.1 and Node 22.14.0 on the runner (Node 24 ships npm
11.17.0), and pnpm 11.0.9 with `pnpm/action-setup` v6.0.6 - `pnpm publish` delegates to `npm publish`, and
earlier pnpm 11.0.x releases lost the OIDC handshake on the way, failing with a masked `E404`.

Once a package is on trusted publishing npm generates its provenance automatically, so the explicit
`--provenance` flag becomes redundant for it - harmless, and still doing the work for every package left on
the token path.

### Why `NPM_TOKEN` comes out afterwards

While the secret is still set, a broken trusted-publisher configuration does not fail the release: the
publish quietly falls back to the token, and the package drops from the Trusted Publisher trust tier back to
Provenance without saying so. Remove `NODE_AUTH_TOKEN` from a publish step once every package that step can
publish has a working trusted publisher, so a misconfiguration fails loudly instead.

Trust tiers are safe to climb and not to descend: pnpm refuses to install a version whose trust level
regressed from the previous one (`ERR_PNPM_TRUST_DOWNGRADE`), so a package that has published with provenance
must keep publishing with at least provenance.

## Releasing a reusable Action (`actions/<name>/vX.Y.Z`)

The repo publishes four reusable Actions - `actions/binary`, `actions/format`, `actions/transpile`, and `actions/tssl` - each versioned independently. An Action is consumed as `uses: BGforgeNet/BGforge-MLS/actions/<name>@<ref>`. Releasing one is purely a matter of tags; there is nothing to build or publish.

An Action's tag covers the Action, not the CLI it drives. Each installs its CLI from npm at the caller's `version` input (default `latest`), so the tag pins the workflow steps while the CLI version is resolved at run time - a library release reaches Action consumers on its own, and only a change under `actions/**` calls for a new Action tag.

1. Choose the commit to release. It must contain the `actions/<name>/` directory, the shared `actions/_shared/` directory it sources at runtime, and the current, filtered `build.yml`. A commit from before the trigger was filtered is unsafe: its `build.yml` runs on every tag and would start a full extension release on the Action tag push.
2. Create the immutable tag and move the major alias to it (example for `binary`; substitute `format`, `transpile` or `tssl`):
   ```
   git tag actions/binary/v1.0.0 <commit>
   git tag -f actions/binary/v1 <commit>
   git push origin actions/binary/v1.0.0
   git push -f origin actions/binary/v1
   ```
3. Bump the major (`v2`) for breaking changes to that Action's interface. The four Actions version independently - a bump to one does not move the others.

The workflow that runs for any tag push is read from the tagged commit, not from the default branch - which is why the chosen commit must already carry the filtered `build.yml`.

## Safety notes

- A bare `vX.Y.Z` always means the extension. Never tag a library or the Action with an unprefixed `vX.Y.Z`, or you start a full extension release at whatever version `package.json` currently holds.
- Tag-name typos that match no pattern - a missing `v`, or a two-part version like `binary/v1.2` - trigger nothing. They fail safe rather than misfire.
