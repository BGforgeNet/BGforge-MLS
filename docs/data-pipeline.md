# Data Pipeline

How engine data moves from external sources to runtime-loadable JSON, TextMate grammars and generated source.

```
EXTERNAL SOURCES
─────────────────────────────────────────────────────────────────────────────

  sfall repo                    IESDP repo              IESDP ids pages
  (sfall-team/sfall)            (BGforgeNet/iesdp)      (BGforgeNet/iesdp)
        │                             │                        │
        ▼                             ▼                        ▼
  fallout-update.sh            ie-update.sh            baf-ids-update.ts
                                                        (via ie-update.sh)
        │                             │                        │
        ▼                             ▼                        ▼
  fallout-ssl-sfall.yml        weidu-baf-iesdp.yml      weidu-baf-ids.yml


HAND-MAINTAINED (server/data/)
─────────────────────────────────────────────────────────────────────────────

  fallout-ssl-base.yml        fallout-worldmap-txt.yml    weidu-baf-base.yml
  weidu-tp2-base.yml          weidu-d-base.yml


generate-data.sh   (run by the data updates and publish-server.sh; outputs are committed)
─────────────────────────────────────────────────────────────────────────────

  fallout-ssl-base.yml  ──┐
  fallout-ssl-sfall.yml ──┤──► completion.fallout-ssl.json
                          └──► signature.fallout-ssl.json

  fallout-ssl-base.yml ──► extract-engine-proc-docs.ts
                                  ├──► fallout-ssl-engine-proc-docs.json    (SSL LSP hover enrichment + TSSL plugin hover docs)
                                  └──► fallout-ssl-engine-procedures.json   (server tree-shaking + TSSL plugin TS6133 suppression)

  Note: extract-engine-proc-docs.ts reads item.doc directly from YAML.
  There is no separate hover output - each completion item carries its own pre-formatted
  documentation, which is what the server reads hover content from (core/static-loader.ts).

  fallout-ssl-base.yml  ──► update-fallout-base-functions-highlight.ts ──┐
  fallout-ssl-sfall.yml ──► update-sfall-highlight.ts                    ├──► fallout-ssl.tmLanguage.yml
                                                                          ┘
  fallout-worldmap-txt.yml ──► completion.fallout-worldmap-txt.json

  weidu-tp2-base.yml ──► completion.weidu-tp2.json
                     ──► update-tp2-highlight.ts ──► weidu-tp2.tmLanguage.yml

  weidu-baf-base.yml  ──┐
  weidu-baf-iesdp.yml ──┤──► completion.weidu-baf.json
  weidu-baf-ids.yml   ──┘──► server/src/weidu-baf/strref-params.ts
  weidu-baf-iesdp.yml    ──► update-baf-highlight.ts ──► weidu-baf.tmLanguage.yml

  weidu-d-base.yml ──► completion.weidu-d.json
                   ──► update-d-highlight.ts ──► weidu-d.tmLanguage.yml


syntaxes-to-json.sh   (runs after any tmLanguage.yml change)
─────────────────────────────────────────────────────────────────────────────

  *.tmLanguage.yml ──► *.tmLanguage.json
```

`server/src/weidu-baf/strref-params.ts` maps each action taking a TLK string reference to the argument positions
holding one, so the server annotates strrefs from the engine data rather than a list kept in code; why it is a
TypeScript module rather than JSON is in the doc comment on `renderStrRefParamsModule` in
`scripts/utils/src/generate-data.ts`.

## When generate-data.sh runs

No build script runs it. `pnpm update-data`, `pnpm ie-update` and `pnpm fallout-update` run it after refreshing the
YAML, `scripts/publish-server.sh` runs it before bundling unless `SKIP_BUILD=1` (which the CI release path in
`build.yml` sets), and `pnpm generate-data` runs it alone - after any hand edit under `server/data/`. Its outputs are committed, so a clean checkout builds and tests without it.

## Other generators

Run each when its input changes (`pnpm build:all` also runs `pnpm build:editors`); the header of the script it runs
describes it.

| Command                                                      | Reads                                                         | Writes                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec tsx scripts/utils/src/update-ssl-engine-arity.ts` | `server/data/fallout-ssl-*.yml` signatures                    | The `args` counts in `compilers/ssl/src/int/engine-functions.ts`                                                       |
| `pnpm ie-binary-update`                                      | IESDP `_data/file_formats/` and `_opcodes/`                   | The IE wire specs under `binary/src/{itm,spl,eff,ie-common}/specs/`, plus the opcode tables in `binary/src/ie-common/` |
| `pnpm build:editors`                                         | `server/data/*.yml`, via `scripts/utils/src/language-defs.ts` | The Kate, Notepad++ and Geany bundles in `dist/` (build output, not committed)                                         |
| `pnpm regen:td-blocklist`                                    | The installed TypeScript's ES lib chain                       | The ES-lib completion blocklist in `plugins/td-plugin/src/filter-completions.ts`                                       |
| `scripts/build-pidtypes.sh <proto-dir> <output.json>`        | Extracted Fallout 2 `.pro` files                              | `binary/data/fallout2-pidtypes.json`                                                                                   |

The tree-sitter `SyntaxType` enums are generated from the grammars rather than from engine data: see
[grammars/README.md](../grammars/README.md#type-generation).

See also: [scripts/README.md](../scripts/README.md) | [server/data/README.md](../server/data/README.md) | [architecture.md](architecture.md)
