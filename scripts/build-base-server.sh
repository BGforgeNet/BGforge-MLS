#!/bin/bash

set -eu -o pipefail

# Build server bundle
# --define replaces import.meta.url references with __imu (defined in --banner).
# Shebang is for npm bin entry; harmless when VSCode spawns via node
# (Node treats #! as a comment in CJS modules).
# See esbuild-lib.sh for rationale on the __imu shim.

# shellcheck source=scripts/esbuild-lib.sh
source "$(dirname "$0")/esbuild-lib.sh"

esbuild ./server/src/server.ts --bundle --outfile=server/out/server.js \
    --external:vscode --external:rolldown --format=cjs --platform=node \
    --banner:js="$imu_banner_with_shebang" \
    "$imu_define" \
    "$@"

# The SSL compile worker is a second entry point, not part of the server bundle: a worker thread is
# started from its own file, and it must sit beside server.js because that is where it is looked up.
# No shebang - it is loaded by the Worker constructor, never executed directly.
esbuild ./server/src/fallout-ssl/compile-worker.ts --bundle --outfile=server/out/compile-worker.js \
    --external:vscode --external:rolldown --format=cjs --platform=node \
    --banner:js="$imu_banner" \
    "$imu_define" \
    "$@"

# The TSSL compile worker, a third entry point for the same reason: it is started as a worker thread
# from its own file, beside server.js. It carries ts-morph, which is ~90% of it.
#
# Note this does NOT keep ts-morph out of server.js: the dialog parsers and compile.ts reach it too, so
# server.js bundles its own full copy and pays ~300ms of parse and evaluation at every start. The split
# is worth keeping for the reason it was made - a cold compile is ~700ms of synchronous CPU that would
# otherwise stall hover and completion - not for bundle size.
#
# Externalising ts-morph to server/node_modules so it ships once was measured and rejected: worth
# ~0.87 MB of a ~10 MB VSIX, because these bundles are minified and deflate-compressed while the
# node_modules copy would ship unminified. It would also need package.sh to deref a dependency TREE
# (pnpm stores @ts-morph/common and code-block-writer as siblings of the symlink target, not inside it)
# and to stop deleting server/node_modules/@*/. The bundler's wasm is the larger target at 3.5 MB
# stored, but it is not slack: swapping esbuild-wasm for rolldown's wasi binding traded 3.79 MB for
# 3.56 MB, so a real cut there has to remove the bundler, not re-pick one.
esbuild ./server/src/tssl/compile-worker.ts --bundle --outfile=server/out/tssl-compile-worker.js \
    --external:vscode --external:rolldown --format=cjs --platform=node \
    --banner:js="$imu_banner" \
    "$imu_define" \
    "$@"

# The WebAssembly compiler's wrapper. Copied rather than bundled: it is forked as a file, and the module
# it loads is resolved from server/node_modules at run time. It must sit beside server.js, which is where
# ssl_compiler.ts looks for it - the same relative path that finds it next to the source.
cp server/src/sslc/sslc-wrapper.mjs server/out/

# Copy tree-sitter WASM files
copy_wasm_to server/out

# Diagnostics-only grammars (MSG/TRA): parsed by the server for parse-error
# diagnostics, but unused by the format CLI - so they ship to server/out only and
# are not part of the shared copy_wasm_to helper (which also feeds format/out).
cp grammars/fallout-msg/tree-sitter-fallout_msg.wasm server/out/
cp grammars/weidu-tra/tree-sitter-weidu_tra.wasm server/out/

# Copy TD runtime declarations (used by the TD TypeScript plugin)
cp transpilers/td/src/td-runtime.d.ts server/out/
