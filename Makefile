.ONESHELL:
SHELL := bash
.SHELLFLAGS := -e -u -c -o pipefail
.DELETE_ON_ERROR:
MAKEFLAGS += --warn-undefined-variables
MAKEFLAGS += --no-builtin-rules

MAC_APP_DIR := apps/mac
.DEFAULT_GOAL := help
.PHONY: help mac-generate mac-generate-sources mac-build-ghostty-xcframework mac-build mac-run mac-install-tip mac-archive mac-export-archive mac-format mac-lint mac-check mac-test mac-inspect-dependencies mac-warm-cache

help:  # Display this help.
	@-+echo "Run make with one of the following targets:"
	@-+echo
	@-+grep -Eh "^[a-z-]+:.*#" $(lastword $(MAKEFILE_LIST)) | sed -E 's/^(.*:)(.*#+)(.*)/  \1 @@@ \3 /' | column -t -s "@@@"

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
