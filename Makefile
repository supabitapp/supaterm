.ONESHELL:
SHELL := bash
.SHELLFLAGS := -e -u -c -o pipefail
.DELETE_ON_ERROR:
MAKEFLAGS += --warn-undefined-variables
MAKEFLAGS += --no-builtin-rules

MAC_APP_DIR := apps/mac
WEB_APP_DIR := apps/supaterm.com
WEB_INSTALL_PREREQS := $(WEB_APP_DIR)/package.json $(WEB_APP_DIR)/pnpm-lock.yaml
WEB_NODE_MODULES_STAMP := $(WEB_APP_DIR)/node_modules/.modules.yaml
DOCS_APP_DIR := apps/docs.supaterm.com
DOCS_INSTALL_PREREQS := $(DOCS_APP_DIR)/package.json $(DOCS_APP_DIR)/pnpm-lock.yaml $(DOCS_APP_DIR)/.npmrc
DOCS_NODE_MODULES_STAMP := $(DOCS_APP_DIR)/node_modules/.modules.yaml
WT_INSTALL_URL := https://raw.githubusercontent.com/khoi/git-wt/main/install.sh
WORKTREE ?=
LOGO_OUTPUT ?= /tmp/supaterm-lightning-logo.svg
.DEFAULT_GOAL := help
.PHONY: help install-git-hooks bump-and-release worktree-create mac-tuist-install mac-generate mac-tuist-generate mac-generate-sources mac-tuist-generate-release mac-tuist-generate-release-cached mac-build-ghostty mac-build-zmx mac-build-ap mac-build mac-build-snapshot-catalog mac-run mac-run-demo mac-run-snapshot-catalog mac-generate-lightning-logo-svg mac-xcode-open mac-install-tip mac-archive mac-archive-xcodebuild mac-export-archive mac-format swiftlint mac-check mac-test mac-test-xcodebuild mac-test-e2e mac-test-ui mac-test-snapshots mac-record-snapshots mac-scan-dead-code mac-inspect-dependencies mac-warm-cache web-help web-install web-dev web-worker-dev web-check web-lint web-fmt web-test web-build web-preview web-deploy docs-install docs-dev docs-check docs-validate docs-build docs-preview docs-deploy

help:  # Display this help.
	@-+echo "Run make with one of the following targets:"
	@-+echo
	@-+grep -Eh "^[a-z-]+:.*#" $(lastword $(MAKEFILE_LIST)) | sed -E 's/^(.*:)(.*#+)(.*)/  \1 @@@ \3 /' | column -t -s "@@@"

install-git-hooks:  # Install repo-local Git hooks.
	@mise exec -- hk install --mise

bump-and-release:  # Compute the next CalVer version, then push an annotated release tag for the stable build.
	@python3 .github/scripts/bump_and_release.py

worktree-create:  # Create a worktree and copy ignored and untracked files. Example: make worktree-create WORKTREE=my-branch
	@test -n "$(WORKTREE)" || { echo "error: WORKTREE is required, example: make worktree-create WORKTREE=my-branch" >&2; exit 1; }; \
	export PATH="$$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$$PATH"; \
	wt_bin="$$(command -v wt || true)"; \
	if [ -z "$$wt_bin" ]; then \
		tmp="$$(mktemp)"; \
		trap 'rm -f "$$tmp"' EXIT; \
		if command -v curl >/dev/null 2>&1; then \
			curl -fsSL "$(WT_INSTALL_URL)" -o "$$tmp"; \
		elif command -v wget >/dev/null 2>&1; then \
			wget -qO "$$tmp" "$(WT_INSTALL_URL)"; \
		else \
			echo "error: curl or wget is required to install wt" >&2; \
			exit 1; \
		fi; \
		sh "$$tmp"; \
		export PATH="$$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$$PATH"; \
		wt_bin="$$(command -v wt || true)"; \
	fi; \
	test -n "$$wt_bin" || { echo "error: failed to install wt" >&2; exit 1; }; \
	"$$wt_bin" switch "$(WORKTREE)" --from "$$(git rev-parse HEAD)" --copy-ignored --copy-untracked

mac-tuist-install:
	@$(MAKE) -C "$(MAC_APP_DIR)" tuist-install

mac-generate:  # Resolve packages and generate the macOS Xcode workspace.
	@$(MAKE) -C "$(MAC_APP_DIR)" generate-project

mac-tuist-generate:
	@$(MAKE) -C "$(MAC_APP_DIR)" tuist-generate

mac-generate-sources:  # Generate the source-only macOS Xcode workspace.
	@$(MAKE) -C "$(MAC_APP_DIR)" generate-project-sources

mac-tuist-generate-release:
	@$(MAKE) -C "$(MAC_APP_DIR)" tuist-generate-release

mac-tuist-generate-release-cached:
	@$(MAKE) -C "$(MAC_APP_DIR)" tuist-generate-release-cached

mac-build-ghostty:
	@$(MAKE) -C "$(MAC_APP_DIR)" build-ghostty

mac-build-zmx:
	@$(MAKE) -C "$(MAC_APP_DIR)" build-zmx

mac-build-ap:
	@$(MAKE) -C "$(MAC_APP_DIR)" build-ap

mac-build:  # Build the macOS app in Debug.
	@$(MAKE) -C "$(MAC_APP_DIR)" build-app

mac-build-snapshot-catalog:  # Build the macOS snapshot catalog app in Debug.
	@$(MAKE) -C "$(MAC_APP_DIR)" build-snapshot-catalog

mac-run:  # Build and run the macOS app in Debug.
	@$(MAKE) -C "$(MAC_APP_DIR)" run-app

mac-run-demo:  # Build and run the macOS app in demo mode.
	@$(MAKE) -C "$(MAC_APP_DIR)" run-app-demo

mac-run-snapshot-catalog:  # Build and run the macOS snapshot catalog app.
	@$(MAKE) -C "$(MAC_APP_DIR)" run-snapshot-catalog

mac-generate-lightning-logo-svg:  # Generate the Icon Composer-ready SVG logo.
	@$(MAKE) -C "$(MAC_APP_DIR)" generate-lightning-logo-svg LOGO_OUTPUT="$(LOGO_OUTPUT)"

mac-xcode-open:  # Open the macOS Xcode workspace.
	@open "$(MAC_APP_DIR)/supaterm.xcworkspace"

mac-install-tip:  # Install the latest tip release for the macOS app.
	@$(MAKE) -C "$(MAC_APP_DIR)" install-tip

mac-archive:  # Archive the macOS app for distribution.
	@$(MAKE) -C "$(MAC_APP_DIR)" archive

mac-archive-xcodebuild:
	@$(MAKE) -C "$(MAC_APP_DIR)" archive-xcodebuild XCODEBUILD_FLAGS='$(XCODEBUILD_FLAGS)'

mac-export-archive:  # Export the archived macOS app for distribution.
	@$(MAKE) -C "$(MAC_APP_DIR)" export-archive

mac-format:  # Format macOS app code.
	@$(MAKE) -C "$(MAC_APP_DIR)" format

swiftlint:  # Lint macOS app Swift code.
	@$(MAKE) -C "$(MAC_APP_DIR)" lint

mac-check:  # Run local formatting and linting for the macOS app.
	@$(MAKE) -C "$(MAC_APP_DIR)" check

mac-test:  # Run the macOS test suite.
	@$(MAKE) -C "$(MAC_APP_DIR)" test

mac-test-xcodebuild:
	@$(MAKE) -C "$(MAC_APP_DIR)" test-xcodebuild

mac-test-e2e:  # Run the macOS end-to-end tests.
	@$(MAKE) -C "$(MAC_APP_DIR)" test-e2e

mac-test-ui:  # Run the macOS UI tests.
	@$(MAKE) -C "$(MAC_APP_DIR)" test-ui

mac-test-snapshots:  # Run the macOS snapshot tests.
	@$(MAKE) -C "$(MAC_APP_DIR)" test-snapshots

mac-record-snapshots:  # Record macOS snapshot references.
	@$(MAKE) -C "$(MAC_APP_DIR)" record-snapshots

mac-scan-dead-code:
	@$(MAKE) -C "$(MAC_APP_DIR)" scan-dead-code

mac-inspect-dependencies:  # Check the macOS Tuist graph for implicit dependencies.
	@$(MAKE) -C "$(MAC_APP_DIR)" inspect-dependencies

mac-warm-cache:  # Warm the macOS external Tuist cache.
	@$(MAKE) -C "$(MAC_APP_DIR)" warm-cache

web-help:  # Show available Vite+ commands for the web app.
	@cd "$(WEB_APP_DIR)" && vp help

$(WEB_NODE_MODULES_STAMP): $(WEB_INSTALL_PREREQS)
	@cd "$(WEB_APP_DIR)" && vp install

web-install: $(WEB_NODE_MODULES_STAMP)  # Install web app dependencies.
	@:

web-dev: $(WEB_NODE_MODULES_STAMP)  # Run the web development server.
	@cd "$(WEB_APP_DIR)" && vp dev

web-worker-dev: $(WEB_NODE_MODULES_STAMP)  # Run the Cloudflare Worker with built assets.
	@cd "$(WEB_APP_DIR)" && vp exec wrangler dev

web-check: $(WEB_NODE_MODULES_STAMP)  # Run formatting, linting, and type checks for the web app.
	@cd "$(WEB_APP_DIR)" && vp check

web-lint: $(WEB_NODE_MODULES_STAMP)  # Lint the web app.
	@cd "$(WEB_APP_DIR)" && vp lint

web-fmt: $(WEB_NODE_MODULES_STAMP)  # Format web app files.
	@cd "$(WEB_APP_DIR)" && vp fmt

web-test: $(WEB_NODE_MODULES_STAMP)  # Run the web app test suite.
	@cd "$(WEB_APP_DIR)" && vp test

web-build: $(WEB_NODE_MODULES_STAMP)  # Build the web app for production.
	@cd "$(WEB_APP_DIR)" && vp build

web-preview: $(WEB_NODE_MODULES_STAMP)  # Preview the built web app.
	@cd "$(WEB_APP_DIR)" && vp preview

web-deploy: $(WEB_NODE_MODULES_STAMP)  # Deploy the web app to Cloudflare Workers.
	@cd "$(WEB_APP_DIR)" && vp exec wrangler deploy

$(DOCS_NODE_MODULES_STAMP): $(DOCS_INSTALL_PREREQS)
	@cd "$(DOCS_APP_DIR)" && vp install

docs-install: $(DOCS_NODE_MODULES_STAMP)  # Install documentation site dependencies.
	@:

define run-docs
@cd "$(DOCS_APP_DIR)" && vp run $(1)
endef

docs-dev: $(DOCS_NODE_MODULES_STAMP)  # Run the documentation development server.
	$(call run-docs,dev)

docs-check: $(DOCS_NODE_MODULES_STAMP)  # Type-check the documentation site.
	$(call run-docs,check)

docs-validate: $(DOCS_NODE_MODULES_STAMP)  # Validate documentation links.
	$(call run-docs,validate)

docs-build: $(DOCS_NODE_MODULES_STAMP)  # Build the documentation site for production.
	$(call run-docs,build)

docs-preview: docs-build  # Build and preview the documentation site.
	$(call run-docs,preview)

docs-deploy: docs-build  # Build and deploy the documentation site to Cloudflare Workers.
	$(call run-docs,deploy)
