# Working on the TSSL compiler

What the compiler is, how to use it, and the full folib contract: the package README. The shared back end and the
differentials that gate both front ends: `compilers/ssl/AGENTS.md`.

## Verifying anything folib-facing

- **No in-repo test stands folib up.** The only gate is `pnpm tssl-int-diff <checked-out mod>`, e.g.
  `pnpm tssl-int-diff external/fallout/FO2tweaks`.
- An unresolvable import is refused, not skipped: with folib absent the gate exits non-zero on
  `cannot resolve module 'folib'`. Read a green run as meaningful only after confirming it resolved folib.

## Do not

- **Add folib to a manifest, vendor it, or pin it.** It is the user's dependency, resolved from their
  `node_modules`.
- **Tighten any of the three guarantees** the README lists under "What this compiler guarantees folib". Each breaks
  a released folib rather than this package, and nothing here raises a compile error when you do.
- **Read folib through compiled output.** The compiler needs declaration nodes, so `moduleResolution` stays
  `Bundler` and no bundler enters the pipeline. Compiled output silently stops `@inline` producing macros.
- **Add another hardcoded folib name** without re-checking the closed-set argument in the README - the existing
  four rest on it.
