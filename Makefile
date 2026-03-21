.ONESHELL:
SHELL := bash
.SHELLFLAGS := -e -u -c -o pipefail
.DELETE_ON_ERROR:
MAKEFLAGS += --warn-undefined-variables
MAKEFLAGS += --no-builtin-rules

MAC_APP_DIR := apps/mac
WEB_APP_DIR := apps/supaterm.com
GIT_HOOKS_DIR := .git-hooks
.DEFAULT_GOAL := help
.PHONY: help install-git-hooks mac-generate mac-generate-sources mac-build-ghostty-xcframework mac-build mac-run mac-install-tip mac-archive mac-export-archive mac-format mac-lint mac-check mac-test mac-inspect-dependencies mac-warm-cache web-help web-install web-dev web-worker-dev web-check web-lint web-fmt web-test web-build web-preview web-deploy

help:  # Display this help.
	@-+echo "Run make with one of the following targets:"
	@-+echo
	@-+grep -Eh "^[a-z-]+:.*#" $(lastword $(MAKEFILE_LIST)) | sed -E 's/^(.*:)(.*#+)(.*)/  \1 @@@ \3 /' | column -t -s "@@@"

install-git-hooks:  # Install repo-local Git hooks.
	@chmod +x "$(GIT_HOOKS_DIR)/pre-commit" && git config --local core.hooksPath "$(GIT_HOOKS_DIR)"

mac-generate:  # Resolve packages and generate the macOS Xcode workspace.
	@$(MAKE) -C "$(MAC_APP_DIR)" generate-project

mac-generate-sources:  # Generate the source-only macOS Xcode workspace.
	@$(MAKE) -C "$(MAC_APP_DIR)" generate-project-sources

mac-build-ghostty-xcframework:  # Build GhosttyKit and bundled resources for the macOS app.
	@$(MAKE) -C "$(MAC_APP_DIR)" build-ghostty-xcframework

mac-build:  # Build the macOS app in Debug.
	@$(MAKE) -C "$(MAC_APP_DIR)" build-app

mac-run:  # Build and run the macOS app in Debug.
	@$(MAKE) -C "$(MAC_APP_DIR)" run-app

mac-install-tip:  # Install the latest tip release for the macOS app.
	@$(MAKE) -C "$(MAC_APP_DIR)" install-tip

mac-archive:  # Archive the macOS app for distribution.
	@$(MAKE) -C "$(MAC_APP_DIR)" archive

mac-export-archive:  # Export the archived macOS app for distribution.
	@$(MAKE) -C "$(MAC_APP_DIR)" export-archive

mac-format:  # Format macOS app code.
	@$(MAKE) -C "$(MAC_APP_DIR)" format

mac-lint:  # Lint macOS app code.
	@$(MAKE) -C "$(MAC_APP_DIR)" lint

mac-check:  # Run local formatting and linting for the macOS app.
	@$(MAKE) -C "$(MAC_APP_DIR)" check

mac-test:  # Run the macOS test suite.
	@$(MAKE) -C "$(MAC_APP_DIR)" test

mac-inspect-dependencies:  # Check the macOS Tuist graph for implicit dependencies.
	@$(MAKE) -C "$(MAC_APP_DIR)" inspect-dependencies

mac-warm-cache:  # Warm the macOS Tuist external dependency cache.
	@$(MAKE) -C "$(MAC_APP_DIR)" warm-cache

web-help:  # Show available Vite+ commands for the web app.
	@cd "$(WEB_APP_DIR)" && vp help

web-install:  # Install web app dependencies.
	@cd "$(WEB_APP_DIR)" && vp install

web-dev:  # Run the web development server.
	@cd "$(WEB_APP_DIR)" && vp dev

web-worker-dev:  # Run the Cloudflare Worker with built assets.
	@cd "$(WEB_APP_DIR)" && vp exec wrangler dev

web-check:  # Run formatting, linting, and type checks for the web app.
	@cd "$(WEB_APP_DIR)" && vp check

web-lint:  # Lint the web app.
	@cd "$(WEB_APP_DIR)" && vp lint

web-fmt:  # Format web app files.
	@cd "$(WEB_APP_DIR)" && vp fmt

web-test:  # Run the web app test suite.
	@cd "$(WEB_APP_DIR)" && vp test

web-build:  # Build the web app for production.
	@cd "$(WEB_APP_DIR)" && vp build

web-preview:  # Preview the built web app.
	@cd "$(WEB_APP_DIR)" && vp preview

web-deploy:  # Deploy the web app to Cloudflare Workers.
	@cd "$(WEB_APP_DIR)" && vp exec wrangler deploy
