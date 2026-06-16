#!/bin/bash

# Build editor-specific syntax highlighting bundles from YAML data and static files.
# Produces versioned zip archives for TextMate (Sublime/JetBrains), Kate, Notepad++, and Geany.

set -eu -o pipefail

version=${ARTIFACT_VERSION:-$(node -p "require('./package.json').version")}
mkdir -p dist

# -- TextMate bundle (Sublime Text / JetBrains) --

tmbundle_name="bgforge-mls"
tmbundle_dir="${tmbundle_name}.tmbundle"
tmbundle_zip="dist/${tmbundle_name}-${version}.tmbundle.zip"

rm -rf "$tmbundle_dir" "$tmbundle_zip"
mkdir -p "$tmbundle_dir/Syntaxes"

cat > "$tmbundle_dir/info.plist" << 'PLIST'
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
for f in syntaxes/*.tmLanguage.json; do
    base=$(basename "$f")
    case "$base" in
        bgforge-mls-*|*-tooltip.*) continue ;;
    esac
    cp "$f" "$tmbundle_dir/Syntaxes/"
done

zip -rq "$tmbundle_zip" "$tmbundle_dir"
rm -rf "$tmbundle_dir"
echo "Created $tmbundle_zip"

# -- Kate KSyntaxHighlighting --

ksh_name="bgforge-mls-kate-ksh"
ksh_dir="${ksh_name}"
ksh_zip="dist/${ksh_name}-${version}.zip"

rm -rf "$ksh_dir" "$ksh_zip"
pnpm exec tsx scripts/utils/src/generate-ksh.ts --out-dir "$ksh_dir"
cp editors/kate/*.ksh.xml "$ksh_dir/"

# File icons: shared-mime-info definitions plus matching icons, installed into the
# XDG MIME database and icon theme (see docs/editors/kate.md). Icons reuse the shared
# theme assets (single source: themes/icons). BAF/TP2 are raster-only upstream, so they
# ship no scalable icon here and fall back to the generic file icon.
mkdir -p "$ksh_dir/mimetypes"
cp editors/kate/bgforge-mls.mime.xml "$ksh_dir/mimetypes/"
cp themes/icons/fallout-ssl.svg  "$ksh_dir/mimetypes/application-x-fallout-ssl.svg"
cp themes/icons/seti-msg-tra.svg "$ksh_dir/mimetypes/application-x-weidu-tra.svg"
cp themes/icons/seti-msg-tra.svg "$ksh_dir/mimetypes/application-x-fallout-msg.svg"
cp themes/icons/infinity-2da.svg "$ksh_dir/mimetypes/application-x-infinity-2da.svg"
cp themes/icons/fallout-pro.svg  "$ksh_dir/mimetypes/application-x-fallout-pro.svg"
cp themes/icons/fallout-map.svg  "$ksh_dir/mimetypes/application-x-fallout-map.svg"
cp themes/icons/infinity-itm.svg "$ksh_dir/mimetypes/application-x-infinity-itm.svg"
cp themes/icons/infinity-spl.svg "$ksh_dir/mimetypes/application-x-infinity-spl.svg"
cp themes/icons/infinity-eff.svg "$ksh_dir/mimetypes/application-x-infinity-eff.svg"
cp themes/icons/infinity-cre.svg "$ksh_dir/mimetypes/application-x-infinity-cre.svg"

zip -rq "$ksh_zip" "$ksh_dir"
rm -rf "$ksh_dir"
echo "Created $ksh_zip"

# -- Notepad++ UDL --

udl_name="bgforge-mls-notepadpp-udl"
udl_dir="${udl_name}"
udl_zip="dist/${udl_name}-${version}.zip"

rm -rf "$udl_dir" "$udl_zip"
pnpm exec tsx scripts/utils/src/generate-udl.ts --out-dir "$udl_dir"
cp editors/notepadpp/*.udl.xml "$udl_dir/"

zip -rq "$udl_zip" "$udl_dir"
rm -rf "$udl_dir"
echo "Created $udl_zip"

# -- Geany --

geany_name="bgforge-mls-geany"
geany_dir="${geany_name}"
geany_zip="dist/${geany_name}-${version}.zip"

rm -rf "$geany_dir" "$geany_zip"
pnpm exec tsx scripts/utils/src/generate-geany.ts --out-dir "$geany_dir"

# Copy hand-written conf files: editors/geany/<name>.conf -> filetypes.<name>.conf
for f in editors/geany/*.conf; do
    [ -e "$f" ] || continue
    base=$(basename "$f" .conf)
    cp "$f" "$geany_dir/filetypes.${base}.conf"
done

zip -rq "$geany_zip" "$geany_dir"
rm -rf "$geany_dir"
echo "Created $geany_zip"
