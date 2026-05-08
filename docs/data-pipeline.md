# Data Pipeline

How engine data moves from external sources to runtime-loadable JSON and TextMate grammars.

```
EXTERNAL SOURCES
─────────────────────────────────────────────────────────────────────────────

  sfall repo                    IESDP repo              IDS files
  (BGforgeNet/sfall)            (BGforgeNet/iesdp)      (manual, game install)
        │                             │                        │
        ▼                             ▼                        ▼
  fallout-update.sh            ie-update.sh            ids-to-yaml.ts
                                                        (manual one-off run)
        │                             │                        │
        ▼                             ▼                        ▼
  fallout-ssl-sfall.yml        weidu-baf-iesdp.yml      weidu-baf-ids.yml


HAND-MAINTAINED (server/data/)
─────────────────────────────────────────────────────────────────────────────

  fallout-ssl-base.yml        fallout-worldmap-txt.yml    weidu-baf-base.yml
  weidu-tp2-base.yml          weidu-d-base.yml


generate-data.sh   (runs at build time - produces all runtime outputs)
─────────────────────────────────────────────────────────────────────────────

  fallout-ssl-base.yml  ──┐
  fallout-ssl-sfall.yml ──┤──► completion.fallout-ssl.json
                          ├──► hover.fallout-ssl.json
                          └──► signature.fallout-ssl.json

  fallout-ssl-base.yml ──► extract-engine-proc-docs.ts
                                  ├──► fallout-ssl-engine-proc-docs.json    (SSL LSP hover enrichment + TSSL plugin hover docs)
                                  └──► fallout-ssl-engine-procedures.json   (server tree-shaking + TSSL plugin TS6133 suppression)

  Note: extract-engine-proc-docs.ts reads item.doc directly from YAML - no intermediate hover JSON needed.

  fallout-ssl-base.yml  ──► update-fallout-base-functions-highlight.ts ──┐
  fallout-ssl-sfall.yml ──► update-sfall-highlight.ts                    ├──► fallout-ssl.tmLanguage.yml
                                                                          ┘
  fallout-worldmap-txt.yml ──► completion.fallout-worldmap-txt.json
                           ──► hover.fallout-worldmap-txt.json

  weidu-tp2-base.yml ──► completion.weidu-tp2.json
                     ──► hover.weidu-tp2.json
                     ──► update-tp2-highlight.ts ──► weidu-tp2.tmLanguage.yml

  weidu-baf-base.yml  ──┐
  weidu-baf-iesdp.yml ──┤──► completion.weidu-baf.json
  weidu-baf-ids.yml   ──┘──► hover.weidu-baf.json
  weidu-baf-iesdp.yml    ──► update-baf-highlight.ts ──► weidu-baf.tmLanguage.yml

  weidu-d-base.yml ──► completion.weidu-d.json
                   ──► hover.weidu-d.json
                   ──► update-d-highlight.ts ──► weidu-d.tmLanguage.yml


syntaxes-to-json.sh   (runs after any tmLanguage.yml change)
─────────────────────────────────────────────────────────────────────────────

  *.tmLanguage.yml ──► *.tmLanguage.json
```

See also: [scripts/README.md](../scripts/README.md) | [server/data/README.md](../server/data/README.md) | [architecture.md](architecture.md)
