# Emacs

Setup guide for using BGforge MLS with Emacs 29+.

- [Prerequisites](#prerequisites)
- [File type detection](#file-type-detection)
- [Tree-sitter highlighting (Emacs 29+)](#tree-sitter-highlighting-emacs-29)
  - [Compile grammars](#compile-grammars)
  - [Font-lock rules](#font-lock-rules)
- [Language server](#language-server)
  - [eglot (built-in, Emacs 29+)](#eglot-built-in-emacs-29)
  - [lsp-mode](#lsp-mode)
- [File icons](#file-icons)
- [TypeScript plugins (TSSL/TD)](#typescript-plugins-tssltd)
- [Settings](#settings)
  - [eglot settings](#eglot-settings)
  - [lsp-mode settings](#lsp-mode-settings)

## Prerequisites

```bash
pnpm install -g @bgforge/mls-server
```

## File type detection

Define major modes first. The mode names match the server's language IDs (`fallout-ssl`, `weidu-baf`, etc.) -- eglot derives the language ID by stripping `-mode` from the major mode name.

```elisp
(define-derived-mode fallout-ssl-mode prog-mode "Fallout-SSL"
  "Major mode for Fallout SSL files."
  (setq-local comment-start "// ")
  (setq-local comment-start-skip "//+\\s-*")
  (setq-local comment-end ""))

(define-derived-mode weidu-baf-mode prog-mode "WeiDU-BAF"
  "Major mode for WeiDU BAF files."
  (setq-local comment-start "// ")
  (setq-local comment-start-skip "//+\\s-*")
  (setq-local comment-end ""))

(define-derived-mode weidu-d-mode prog-mode "WeiDU-D"
  "Major mode for WeiDU D dialog files."
  (setq-local comment-start "// ")
  (setq-local comment-start-skip "//+\\s-*")
  (setq-local comment-end ""))

(define-derived-mode weidu-tp2-mode prog-mode "WeiDU-TP2"
  "Major mode for WeiDU TP2 installer files."
  (setq-local comment-start "// ")
  (setq-local comment-start-skip "//+\\s-*")
  (setq-local comment-end ""))

(define-derived-mode fallout-worldmap-txt-mode conf-mode "Fallout-Worldmap"
  "Major mode for Fallout worldmap.txt files.")

(add-to-list 'auto-mode-alist '("\\.ssl\\'" . fallout-ssl-mode))
(add-to-list 'auto-mode-alist '("\\.h\\'" . fallout-ssl-mode))  ;; or keep c-mode; set per-project
(add-to-list 'auto-mode-alist '("\\.baf\\'" . weidu-baf-mode))
(add-to-list 'auto-mode-alist '("\\.d\\'" . weidu-d-mode))
(add-to-list 'auto-mode-alist '("\\.tp2\\'" . weidu-tp2-mode))
(add-to-list 'auto-mode-alist '("\\.tp[ahp]\\'" . weidu-tp2-mode))
(add-to-list 'auto-mode-alist '("worldmap\\.txt\\'" . fallout-worldmap-txt-mode))

;; Highlight-only languages (no LSP provider)
(define-derived-mode fallout-msg-mode prog-mode "Fallout-MSG"
  "Major mode for Fallout message files.")

(define-derived-mode weidu-tra-mode prog-mode "WeiDU-TRA"
  "Major mode for WeiDU translation files."
  (setq-local comment-start "// ")
  (setq-local comment-start-skip "//+\\s-*")
  (setq-local comment-end ""))

(add-to-list 'auto-mode-alist '("\\.msg\\'" . fallout-msg-mode))
(add-to-list 'auto-mode-alist '("\\.tra\\'" . weidu-tra-mode))
```

Note: `.h` files default to C in Emacs. The config above overrides this globally. For per-project control, use directory-local variables (`.dir-locals.el`) instead.

## Tree-sitter highlighting (Emacs 29+)

### Download the grammar bundle

The generated parsers are not in the git repository, so `treesit-install-language-grammar` cannot build
them from a clone -- it looks for `parser.c`, which is produced at build time. Download the published
bundle instead:

```bash
mkdir -p ~/.local/share/bgforge-mls
curl -fsSL -o /tmp/bgforge-grammars.zip \
  https://github.com/BGforgeNet/BGforge-MLS/releases/latest/download/bgforge-mls-tree-sitter-grammars.zip
unzip -oq /tmp/bgforge-grammars.zip -d ~/.local/share/bgforge-mls
```

That yields `~/.local/share/bgforge-mls/bgforge-mls-tree-sitter-grammars/<grammar>/`, one directory per
grammar. For daily builds from the default branch, replace `latest/download` with
`download/grammars-nightly`.

### Compile grammars

`treesit-language-source-alist` accepts a local directory in place of a repository URL, and looks for
`parser.c` under `src` by default -- which is the bundle's layout, so no revision or source directory is
needed:

```elisp
(let ((bundle (expand-file-name "~/.local/share/bgforge-mls/bgforge-mls-tree-sitter-grammars/")))
  (setq treesit-language-source-alist
        `((ssl ,(concat bundle "fallout-ssl"))
          (baf ,(concat bundle "weidu-baf"))
          (weidu_d ,(concat bundle "weidu-d"))
          (weidu_tp2 ,(concat bundle "weidu-tp2"))
          (fallout_msg ,(concat bundle "fallout-msg"))
          (weidu_tra ,(concat bundle "weidu-tra")))))
```

Leaving the revision out matters: with one set, Emacs runs `git checkout` in that directory, and the
extracted bundle is not a git repository.

Compile each grammar (one-time):

```
M-x treesit-install-language-grammar RET ssl
M-x treesit-install-language-grammar RET baf
M-x treesit-install-language-grammar RET weidu_d
M-x treesit-install-language-grammar RET weidu_tp2
M-x treesit-install-language-grammar RET fallout_msg
M-x treesit-install-language-grammar RET weidu_tra
```

### Font-lock rules

Emacs tree-sitter does not read `.scm` query files directly -- font-lock rules must be defined in elisp. Use the `highlights.scm` files as a reference for node types. Minimal example for Fallout SSL:

```elisp
(require 'treesit)

(defvar fallout-ssl-ts--font-lock-rules
  (treesit-font-lock-rules
   :language 'ssl
   :feature 'comment
   '((comment) @font-lock-comment-face)

   :language 'ssl
   :feature 'string
   '((string) @font-lock-string-face)

   :language 'ssl
   :feature 'keyword
   '((control_flow) @font-lock-keyword-face)

   :language 'ssl
   :feature 'number
   '((number) @font-lock-number-face))
  "Tree-sitter font-lock rules for Fallout SSL.
See grammars/fallout-ssl/queries/highlights.scm for all available captures.")

(define-derived-mode fallout-ssl-ts-mode prog-mode "Fallout-SSL"
  "Major mode for Fallout SSL files with tree-sitter support."
  (when (treesit-ready-p 'ssl)
    (treesit-parser-create 'ssl)
    (setq-local treesit-font-lock-settings fallout-ssl-ts--font-lock-rules)
    (setq-local treesit-font-lock-feature-list '((comment string) (keyword) (number)))
    (treesit-major-mode-setup)))
```

To use tree-sitter modes instead of the basic modes, update `auto-mode-alist`:

```elisp
(add-to-list 'auto-mode-alist '("\\.ssl\\'" . fallout-ssl-ts-mode))
;; Similarly for other languages:
;; (add-to-list 'auto-mode-alist '("\\.baf\\'" . weidu-baf-ts-mode))
;; (add-to-list 'auto-mode-alist '("\\.d\\'" . weidu-d-ts-mode))
;; (add-to-list 'auto-mode-alist '("\\.tp2\\'" . weidu-tp2-ts-mode))
```

Adapt for other languages by changing the language symbol and node names. Translate `@function.builtin` to `font-lock-builtin-face`, `@keyword` to `font-lock-keyword-face`, etc.

The tree-sitter modes and basic modes are independent. If using tree-sitter modes, add the `-ts-mode` variants to the eglot/lsp-mode registration.

## Language server

### eglot (built-in, Emacs 29+)

```elisp
(add-to-list 'eglot-server-programs
             '((fallout-ssl-mode weidu-baf-mode weidu-tp2-mode weidu-d-mode
                fallout-worldmap-txt-mode)
               "bgforge-mls-server" "--stdio"))
```

### [lsp-mode](https://emacs-lsp.github.io/lsp-mode/)

```elisp
(require 'lsp-mode)

(lsp-register-client
 (make-lsp-client
  :new-connection (lsp-stdio-connection '("bgforge-mls-server" "--stdio"))
  :major-modes '(fallout-ssl-mode weidu-baf-mode weidu-tp2-mode weidu-d-mode
                 fallout-worldmap-txt-mode)
  :server-id 'bgforge-mls))
```

## File icons

Icons in `dired`, `treemacs`, the mode line, etc. come from [nerd-icons](https://github.com/rainstormstudio/nerd-icons.el) (or the older `all-the-icons`). Add the BGforge formats to `nerd-icons-extension-icon-alist`:

```elisp
(with-eval-after-load 'nerd-icons
  (dolist (entry
           '(("ssl" nerd-icons-faicon "nf-fa-file_code_o" :face nerd-icons-blue)
             ("baf" nerd-icons-faicon "nf-fa-file_code_o" :face nerd-icons-blue)
             ("d"   nerd-icons-faicon "nf-fa-file_code_o" :face nerd-icons-blue)
             ("tp2" nerd-icons-faicon "nf-fa-file_code_o" :face nerd-icons-blue)
             ("tpa" nerd-icons-faicon "nf-fa-file_code_o" :face nerd-icons-blue)
             ("tph" nerd-icons-faicon "nf-fa-file_code_o" :face nerd-icons-blue)
             ("tpp" nerd-icons-faicon "nf-fa-file_code_o" :face nerd-icons-blue)
             ("slb" nerd-icons-faicon "nf-fa-file_code_o" :face nerd-icons-blue)
             ("msg" nerd-icons-faicon "nf-fa-comment"     :face nerd-icons-lblue)
             ("tra" nerd-icons-faicon "nf-fa-language"    :face nerd-icons-lblue)
             ("2da" nerd-icons-faicon "nf-fa-file_code_o" :face nerd-icons-green)
             ("pro" nerd-icons-faicon "nf-fa-cube"        :face nerd-icons-orange)
             ("map" nerd-icons-faicon "nf-fa-map_o"       :face nerd-icons-orange)
             ("itm" nerd-icons-faicon "nf-fa-cube"        :face nerd-icons-purple)
             ("spl" nerd-icons-faicon "nf-fa-cube"        :face nerd-icons-purple)
             ("eff" nerd-icons-faicon "nf-fa-cube"        :face nerd-icons-purple)
             ("cre" nerd-icons-faicon "nf-fa-cube"        :face nerd-icons-purple)))
    (add-to-list 'nerd-icons-extension-icon-alist entry)))
```

Requires a [Nerd Font](https://www.nerdfonts.com/). Glyph names follow the Nerd Fonts `nf-fa-*` scheme; if a name is unknown in your `nerd-icons` version it signals an error - browse names with `M-x nerd-icons-insert`. `worldmap.txt` has no distinctive extension, so match it by name via `nerd-icons-regexp-icon-alist` if your version provides it. For `all-the-icons`, use the analogous `all-the-icons-extension-icon-alist` with `all-the-icons-faicon` (its glyph names drop the `nf-` prefix).

## TypeScript plugins (TSSL/TD)

If you write `.tssl` or `.td` transpiler files, the server package includes TypeScript plugins that run inside tsserver. See [TypeScript Plugins](typescript-plugins.md) for setup.

## Settings

### eglot settings

```elisp
(setq-default eglot-workspace-configuration
              '(:bgforge
                (:validate "saveAndType"
                 :falloutSSL (:compilePath ""
                              :compileOptions "-q -p -l -O2 -d -s -n"
                              :outputDirectory ""
                              :headersDirectory "")
                 :weidu (:path "weidu"
                         :gamePath ""))))
```

### lsp-mode settings

The server reads settings via `workspace/configuration`. Use `lsp-register-custom-settings` to map variables to configuration paths:

```elisp
(defcustom lsp-bgforge-validate "saveAndType"
  "Validation mode: manual, save, type, or saveAndType." :type 'string :group 'lsp-bgforge)
(defcustom lsp-bgforge-ssl-compile-path ""
  "SSL compile path. Empty = built-in compiler." :type 'string :group 'lsp-bgforge)
(defcustom lsp-bgforge-ssl-compile-options "-q -p -l -O2 -d -s -n"
  "SSL compile options." :type 'string :group 'lsp-bgforge)
(defcustom lsp-bgforge-ssl-output-directory ""
  "SSL output directory." :type 'string :group 'lsp-bgforge)
(defcustom lsp-bgforge-ssl-headers-directory ""
  "SSL headers directory." :type 'string :group 'lsp-bgforge)
(defcustom lsp-bgforge-weidu-path "weidu"
  "WeiDU executable path." :type 'string :group 'lsp-bgforge)
(defcustom lsp-bgforge-weidu-game-path ""
  "WeiDU game path." :type 'string :group 'lsp-bgforge)

(lsp-register-custom-settings
 '(("bgforge.validate" lsp-bgforge-validate)
   ("bgforge.falloutSSL.compilePath" lsp-bgforge-ssl-compile-path)
   ("bgforge.falloutSSL.compileOptions" lsp-bgforge-ssl-compile-options)
   ("bgforge.falloutSSL.outputDirectory" lsp-bgforge-ssl-output-directory)
   ("bgforge.falloutSSL.headersDirectory" lsp-bgforge-ssl-headers-directory)
   ("bgforge.weidu.path" lsp-bgforge-weidu-path)
   ("bgforge.weidu.gamePath" lsp-bgforge-weidu-game-path)))
```

See [Settings Reference](../settings.md) for all available options.
