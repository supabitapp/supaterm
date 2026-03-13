# Sensible defaults
.ONESHELL:
SHELL := bash
.SHELLFLAGS := -e -u -c -o pipefail
.DELETE_ON_ERROR:
MAKEFLAGS += --warn-undefined-variables
MAKEFLAGS += --no-builtin-rules

# Derived values (DO NOT TOUCH).
CURRENT_MAKEFILE_PATH := $(abspath $(lastword $(MAKEFILE_LIST)))
CURRENT_MAKEFILE_DIR := $(patsubst %/,%,$(dir $(CURRENT_MAKEFILE_PATH)))
PROJECT_WORKSPACE := $(CURRENT_MAKEFILE_DIR)/supaterm.xcworkspace
APP_SCHEME := supaterm
GHOSTTY_SUBMODULE_DIR := $(CURRENT_MAKEFILE_DIR)/ThirdParty/ghostty
GHOSTTY_XCFRAMEWORK_PATH := $(CURRENT_MAKEFILE_DIR)/Frameworks/GhosttyKit.xcframework
GHOSTTY_STAMP_DIR := $(CURRENT_MAKEFILE_DIR)/.build/.ghostty-stamps
GHOSTTY_SUBMODULE_HEAD := $(shell if git -C "$(GHOSTTY_SUBMODULE_DIR)" rev-parse --verify HEAD >/dev/null 2>&1; then git -C "$(GHOSTTY_SUBMODULE_DIR)" rev-parse HEAD; else printf missing; fi)
GHOSTTY_SUBMODULE_HEAD_STAMP := $(GHOSTTY_STAMP_DIR)/head-$(GHOSTTY_SUBMODULE_HEAD)
GHOSTTY_BUILD_INPUTS := Makefile mise.toml .gitmodules
TUIST_GENERATION_STAMP_DIR := $(CURRENT_MAKEFILE_DIR)/.build/.tuist-generated-stamps
TUIST_XCODE_CACHE_SETUP_STAMP := $(CURRENT_MAKEFILE_DIR)/.build/.tuist-xcode-cache-setup
TUIST_DEVELOPMENT_GENERATION_STAMP := $(TUIST_GENERATION_STAMP_DIR)/development
TUIST_SOURCE_GENERATION_STAMP := $(TUIST_GENERATION_STAMP_DIR)/none
TUIST_XCODE_CACHE_SETUP_INPUTS := Tuist.swift mise.toml
TUIST_GENERATION_INPUTS := Project.swift Tuist.swift Tuist/Package.swift Tuist/Package.resolved Configurations/Project.xcconfig mise.toml
TUIST_GENERATE_CACHE_PROFILE ?= development
XCODEBUILD_FLAGS ?=
.DEFAULT_GOAL := help
.PHONY: build-ghostty-xcframework build-app run-app install-tip archive export-archive format lint check test inspect-dependencies warm-cache setup-xcode-cache

ifeq ($(CI),)
TUIST_INSTALL_FLAGS :=
else
TUIST_INSTALL_FLAGS := --force-resolved-versions
endif

help:  # Display this help.
	@-+echo "Run make with one of the following targets:"
	@-+echo
	@-+grep -Eh "^[a-z-]+:.*#" $(CURRENT_MAKEFILE_PATH) | sed -E 's/^(.*:)(.*#+)(.*)/  \1 @@@ \3 /' | column -t -s "@@@"

generate-project: $(TUIST_GENERATION_STAMP_DIR)/$(TUIST_GENERATE_CACHE_PROFILE) # Resolve packages and generate Xcode workspace

generate-project-sources: $(TUIST_SOURCE_GENERATION_STAMP) # Resolve packages and generate a source-only Xcode workspace

setup-xcode-cache: $(TUIST_XCODE_CACHE_SETUP_STAMP) # Install Tuist Xcode cache service for this machine

build-ghostty-xcframework: $(GHOSTTY_XCFRAMEWORK_PATH)

$(TUIST_XCODE_CACHE_SETUP_STAMP): $(TUIST_XCODE_CACHE_SETUP_INPUTS)
	mkdir -p "$(dir $@)"
	mise exec -- tuist setup cache
	touch "$@"

$(GHOSTTY_SUBMODULE_HEAD_STAMP): $(GHOSTTY_BUILD_INPUTS)
	mkdir -p "$(GHOSTTY_STAMP_DIR)"
	if [ "$(GHOSTTY_SUBMODULE_HEAD)" = "missing" ]; then \
		echo "error: Missing $(GHOSTTY_SUBMODULE_DIR). Run: git submodule update --init --recursive ThirdParty/ghostty" >&2; \
		exit 1; \
	fi
	rm -f "$(GHOSTTY_STAMP_DIR)"/head-*
	touch "$@"

$(GHOSTTY_XCFRAMEWORK_PATH): $(GHOSTTY_BUILD_INPUTS) $(GHOSTTY_SUBMODULE_HEAD_STAMP)
	mkdir -p "$(dir $@)"
	cd "$(GHOSTTY_SUBMODULE_DIR)" && mise exec -- zig build -Doptimize=ReleaseFast -Demit-xcframework=true -Dsentry=false
	rm -rf "$@"
	rsync -a "$(GHOSTTY_SUBMODULE_DIR)/macos/GhosttyKit.xcframework" "$(dir $@)"

$(TUIST_GENERATION_STAMP_DIR)/%: $(GHOSTTY_XCFRAMEWORK_PATH) $(TUIST_GENERATION_INPUTS)
	mkdir -p "$(TUIST_GENERATION_STAMP_DIR)"
	rm -f "$(TUIST_GENERATION_STAMP_DIR)"/*
	mise exec -- tuist install $(TUIST_INSTALL_FLAGS)
	mise exec -- tuist generate --no-open --cache-profile "$*"
	touch "$@"

build-app: $(TUIST_XCODE_CACHE_SETUP_STAMP) $(TUIST_DEVELOPMENT_GENERATION_STAMP) # Build the macOS app (Debug)
	bash -o pipefail -c 'xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -configuration Debug build -skipMacroValidation 2>&1 | mise exec -- xcbeautify --disable-logging'

run-app: build-app # Build then launch (Debug) with log streaming
	@settings="$$(xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -configuration Debug -showBuildSettings -json 2>/dev/null)"; \
	build_dir="$$(echo "$$settings" | jq -r '.[0].buildSettings.BUILT_PRODUCTS_DIR')"; \
	product="$$(echo "$$settings" | jq -r '.[0].buildSettings.FULL_PRODUCT_NAME')"; \
	exec_name="$$(echo "$$settings" | jq -r '.[0].buildSettings.EXECUTABLE_NAME')"; \
	"$$build_dir/$$product/Contents/MacOS/$$exec_name"

install-tip: # Install tip build from github
	tmpdir="$$(mktemp -d)"; \
	mount_dir=""; \
	trap 'if [ -n "$$mount_dir" ]; then hdiutil detach "$$mount_dir" -quiet >/dev/null 2>&1 || true; fi; rm -rf "$$tmpdir"' EXIT; \
	pkill -x supaterm 2>/dev/null || true; \
	curl -fL "https://github.com/supabitapp/supaterm/releases/download/tip/supaterm.dmg" -o "$$tmpdir/supaterm.dmg"; \
	mount_dir="$$(hdiutil attach "$$tmpdir/supaterm.dmg" -nobrowse | awk -F '\t' '/\/Volumes\// { print $$NF; exit }')"; \
	test -n "$$mount_dir"; \
	rm -rf "/Applications/supaterm.app"; \
	ditto "$$mount_dir/supaterm.app" "/Applications/supaterm.app"

archive: $(TUIST_XCODE_CACHE_SETUP_STAMP) $(TUIST_SOURCE_GENERATION_STAMP) # Archive Release build for distribution
	mkdir -p build
	bash -o pipefail -c 'xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -configuration Release -destination "generic/platform=macOS" -archivePath build/supaterm.xcarchive archive CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="$$APPLE_TEAM_ID" CODE_SIGN_IDENTITY="$$DEVELOPER_ID_IDENTITY_SHA" OTHER_CODE_SIGN_FLAGS="--timestamp" $(XCODEBUILD_FLAGS) -skipMacroValidation 2>&1 | mise exec -- xcbeautify --quiet --disable-logging'

export-archive: # Export archive for distribution
	bash -o pipefail -c 'xcodebuild -exportArchive -archivePath build/supaterm.xcarchive -exportPath build/export -exportOptionsPlist build/ExportOptions.plist 2>&1 | mise exec -- xcbeautify --quiet --disable-logging'

test: $(TUIST_XCODE_CACHE_SETUP_STAMP) $(TUIST_DEVELOPMENT_GENERATION_STAMP) # Run the full macOS test suite
	bash -o pipefail -c 'xcodebuild test -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -destination "platform=macOS" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" -skipMacroValidation 2>&1 | mise exec -- xcbeautify --disable-logging'

format: # Format code with swift-format (local only)
	swift-format -p --in-place --recursive --configuration ./.swift-format.json supaterm supatermTests

lint: # Lint code with swiftlint
	mise exec -- swiftlint lint --quiet --config .swiftlint.yml

inspect-dependencies: $(GHOSTTY_XCFRAMEWORK_PATH) # Check for implicit Tuist dependencies
	mise exec -- tuist install $(TUIST_INSTALL_FLAGS)
	mise exec -- tuist inspect dependencies --only implicit

warm-cache: $(GHOSTTY_XCFRAMEWORK_PATH) # Warm Tuist module cache for external dependencies
	mise exec -- tuist install $(TUIST_INSTALL_FLAGS)
	mise exec -- tuist cache warm --external-only --configuration Debug

check: format lint # Format and lint
