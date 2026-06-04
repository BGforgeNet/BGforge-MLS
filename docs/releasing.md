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
| `actions/binary/vX.Y.Z` | none                  | Immutable release ref for the `actions/binary` reusable Action.                                                                                                           |
| `actions/binary/v1`     | none                  | Moving major alias, re-pointed to the latest `actions/binary/v1.x`.                                                                                                       |

`build.yml` filters its push trigger to `v[0-9]+.[0-9]+.[0-9]+`, and `publish-library.yml` to the three `<lib>/v...` patterns. Any tag matching neither - including every `actions/binary/*` tag - starts no workflow. An Action needs none: it is consumed directly from its source at the pinned git ref, not built or published.

## Releasing the extension (`vX.Y.Z`)

Root `package.json` and `server/package.json` must carry identical versions; they ship together as the VSIX and the `@bgforge/mls-server` npm package (check the current value with `node -p "require('./package.json').version"`).

1. Bump the version in both `package.json` and `server/package.json`.
2. Update `docs/changelog.md` with the user-facing changes.
3. Commit as `Update changelog, bump version: X.Y.Z`.
4. Tag `vX.Y.Z` and push the tag.

If this release ships a server that depends on a freshly bumped `@bgforge/format`, release the `format/vX.Y.Z` tag first - see the ordering note below.

## Releasing a library (`binary` / `format` / `transpile`)

The three library packages version independently of the extension and of each other. Each library and its bundled CLI (`fgbin`, `fgfmt`, `fgtp`) share one `package.json`, so a library and its CLI always move together. Workspace consumers (`server/`, `client/`) reference the packages via `workspace:*`, so bumping a library version does not require updating dependents.

1. Bump the version in the library's `package.json` (`binary/package.json`, `format/package.json`, or `transpilers/package.json` for `@bgforge/transpile`).
2. Commit.
3. Tag `<lib>/vX.Y.Z`, matching the new version exactly, and push the tag.

`publish-library.yml` resolves the tag prefix to the package, verifies the tag version matches the package's `package.json`, runs the package's build and tests, then publishes to npm with provenance.

### Ordering: format before the server

`@bgforge/mls-server` declares a runtime dependency on `@bgforge/format` (`workspace:*`), which is substituted with format's concrete version when the server is published. That version must already be on npm, or a fresh `npm install @bgforge/mls-server` cannot resolve it. So when a `vX.Y.Z` extension release ships a server depending on a bumped format, push the `format/vX.Y.Z` tag first. `publish-server.sh` preflights this and fails fast with a clear message if the format version is missing from npm.

## Releasing the reusable Action (`actions/binary/vX.Y.Z`)

The Action is consumed as `uses: BGforgeNet/BGforge-MLS/actions/binary@<ref>`. Releasing it is purely a matter of tags; there is nothing to build or publish.

1. Choose the commit to release. It must contain both `actions/binary/` and the current, filtered `build.yml`. A commit from before the trigger was filtered is unsafe: its `build.yml` runs on every tag and would start a full extension release on the Action tag push.
2. Create the immutable tag and move the major alias to it:
    ```
    git tag actions/binary/v1.0.0 <commit>
    git tag -f actions/binary/v1 <commit>
    git push origin actions/binary/v1.0.0
    git push -f origin actions/binary/v1
    ```
3. Bump the major (`v2`) for breaking changes to the Action interface.

The workflow that runs for any tag push is read from the tagged commit, not from the default branch - which is why the chosen commit must already carry the filtered `build.yml`.

## Safety notes

- A bare `vX.Y.Z` always means the extension. Never tag a library or the Action with an unprefixed `vX.Y.Z`, or you start a full extension release at whatever version `package.json` currently holds.
- Tag-name typos that match no pattern - a missing `v`, or a two-part version like `binary/v1.2` - trigger nothing. They fail safe rather than misfire.
