#!/bin/bash

# Build editor-specific syntax highlighting bundles from YAML data and static files.
# Produces versioned zip archives for TextMate (Sublime/JetBrains), Kate, Notepad++, and Geany.
#
# The four are independent - separate generators, separate staging directories, separate zips - and three
# of them each pay a `tsx` startup, so they run in parallel rather than one after another.
#
# Each stages under dist/, which is gitignored, rather than at the repo root: the staging directory exists
# only between its generator and its zip, and a `git add -A` landing in that window used to sweep it into a
# commit. Each zip is written from inside dist/ so the archive still has <bundle>/ at its root - the layout
# docs/editors/*.md tell users to extract.

set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

# shellcheck source=scripts/timing-lib.sh
source "$SCRIPT_DIR/timing-lib.sh"

LOG_DIR="$ROOT_DIR/tmp/editor-build-logs"
rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

# shellcheck source=scripts/parallel-lib.sh
source "$SCRIPT_DIR/parallel-lib.sh"

VERSION=${ARTIFACT_VERSION:-$(node -p "require('./package.json').version")}
mkdir -p dist

# -- TextMate bundle (Sublime Text / JetBrains) --

build_tmbundle() {
    local name="bgforge-mls"
    local bundle="${name}.tmbundle"
    local archive="${name}-${VERSION}.tmbundle.zip"
    local dir="dist/${bundle}"
    local zip="dist/${archive}"

    rm -rf "$dir" "$zip"
    mkdir -p "$dir/Syntaxes"

    cat >"$dir/info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>name</key>
	<string>BGforge MLS</string>
	<key>contactName</key>
	<string>BGforge</string>
	<key>description</key>
	<string>Syntax grammars for Fallout SSL, WeiDU (BAF, D, TP2, TRA), and related formats.</string>
	<key>uuid</key>
	<string>b8f3e4a1-7c2d-4f5e-9a1b-3d6e8f0c2a4b</string>
</dict>
</plist>
PLIST

    # Copy language grammars, excluding VSCode-specific injection and tooltip grammars.
    local f base
    for f in syntaxes/*.tmLanguage.json; do
        base=$(basename "$f")
        case "$base" in
            bgforge-mls-* | *-tooltip.*) continue ;;
        esac
        cp "$f" "$dir/Syntaxes/"
    done

    (cd dist && zip -rq "$archive" "$bundle")
    rm -rf "$dir"
    echo "Created $zip"
}

# -- Kate KSyntaxHighlighting --

build_kate() {
    local name="bgforge-mls-kate"
    local archive="${name}-${VERSION}.zip"
    local dir="dist/${name}"
    local zip="dist/${archive}"

    rm -rf "$dir" "$zip"
    pnpm exec tsx scripts/utils/src/generate-ksh.ts --out-dir "$dir"
    cp editors/kate/*.ksh.xml "$dir/"

    # File icons: shared-mime-info definitions plus matching icons, installed into the
    # XDG MIME database and icon theme (see docs/editors/kate.md). Icons reuse the shared
    # theme assets (single source: themes/icons). BAF/TP2 are raster-only upstream, so they
    # ship no scalable icon here and fall back to the generic file icon.
    mkdir -p "$dir/mimetypes"
    cp editors/kate/bgforge-mls.mime.xml "$dir/mimetypes/"
    cp themes/icons/fallout-ssl.svg "$dir/mimetypes/application-x-fallout-ssl.svg"
    cp themes/icons/seti-msg-tra.svg "$dir/mimetypes/application-x-weidu-tra.svg"
    cp themes/icons/seti-msg-tra.svg "$dir/mimetypes/application-x-fallout-msg.svg"
    cp themes/icons/infinity-2da.svg "$dir/mimetypes/application-x-infinity-2da.svg"
    cp themes/icons/fallout-pro.svg "$dir/mimetypes/application-x-fallout-pro.svg"
    cp themes/icons/fallout-map.svg "$dir/mimetypes/application-x-fallout-map.svg"
    cp themes/icons/infinity-itm.svg "$dir/mimetypes/application-x-infinity-itm.svg"
    cp themes/icons/infinity-spl.svg "$dir/mimetypes/application-x-infinity-spl.svg"
    cp themes/icons/infinity-eff.svg "$dir/mimetypes/application-x-infinity-eff.svg"
    cp themes/icons/infinity-cre.svg "$dir/mimetypes/application-x-infinity-cre.svg"

    (cd dist && zip -rq "$archive" "$name")
    rm -rf "$dir"
    echo "Created $zip"
}

# -- Notepad++ UDL --

build_notepadpp() {
    local name="bgforge-mls-notepadpp"
    local archive="${name}-${VERSION}.zip"
    local dir="dist/${name}"
    local zip="dist/${archive}"

    rm -rf "$dir" "$zip"
    pnpm exec tsx scripts/utils/src/generate-udl.ts --out-dir "$dir"
    cp editors/notepadpp/*.udl.xml "$dir/"

    (cd dist && zip -rq "$archive" "$name")
    rm -rf "$dir"
    echo "Created $zip"
}

# -- Geany --

build_geany() {
    local name="bgforge-mls-geany"
    local archive="${name}-${VERSION}.zip"
    local dir="dist/${name}"
    local zip="dist/${archive}"

    rm -rf "$dir" "$zip"
    pnpm exec tsx scripts/utils/src/generate-geany.ts --out-dir "$dir"

    # Copy hand-written conf files: editors/geany/<name>.conf -> filetypes.<name>.conf
    local f base
    for f in editors/geany/*.conf; do
        [ -e "$f" ] || continue
        base=$(basename "$f" .conf)
        cp "$f" "$dir/filetypes.${base}.conf"
    done

    (cd dist && zip -rq "$archive" "$name")
    rm -rf "$dir"
    echo "Created $zip"
}

step "Building editor bundles"
parallel \
    "TextMate" "build_tmbundle" \
    "Kate" "build_kate" \
    "Notepad++" "build_notepadpp" \
    "Geany" "build_geany"

timing_summary "Editor bundles built"
