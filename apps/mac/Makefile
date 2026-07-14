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
LOGO_GENERATOR_SCHEME := SupaThemeLogoGenerator
TUIST_GENERATION_STAMP_DIR := $(CURRENT_MAKEFILE_DIR)/.build/.tuist-generated-stamps
TUIST_INSTALL_STAMP := $(TUIST_GENERATION_STAMP_DIR)/.installed
TUIST_BINARY_CACHE_PROFILE ?= only-external
TUIST_CACHED_GENERATION_STAMP := $(TUIST_GENERATION_STAMP_DIR)/$(TUIST_BINARY_CACHE_PROFILE)
TUIST_SOURCE_GENERATION_STAMP := $(TUIST_GENERATION_STAMP_DIR)/none
TUIST_CACHED_RELEASE_GENERATION_STAMP := $(TUIST_GENERATION_STAMP_DIR)/$(TUIST_BINARY_CACHE_PROFILE)-release
TUIST_SOURCE_RELEASE_GENERATION_STAMP := $(TUIST_GENERATION_STAMP_DIR)/none-release
TUIST_GENERATION_INPUTS := Project.swift Workspace.swift Tuist.swift Tuist/Package.swift Tuist/Package.resolved Configurations/Project.xcconfig ../../mise.toml
TUIST_GENERATE_CACHE_PROFILE ?= $(TUIST_BINARY_CACHE_PROFILE)
TUIST_CACHE_CONFIGURATION ?= Debug
XCODEBUILD_FLAGS ?=
E2E_RESULT_BUNDLE_PATH ?=
E2E_RESULT_BUNDLE_FLAGS := $(if $(strip $(E2E_RESULT_BUNDLE_PATH)),-resultBundlePath "$(E2E_RESULT_BUNDLE_PATH)",)
UI_RESULT_BUNDLE_PATH ?=
UI_RESULT_BUNDLE_FLAGS := $(if $(strip $(UI_RESULT_BUNDLE_PATH)),-resultBundlePath "$(UI_RESULT_BUNDLE_PATH)",)
LOGO_OUTPUT ?= /tmp/supaterm-lightning-logo.svg
.DEFAULT_GOAL := help
.PHONY: tuist-install tuist-generate tuist-generate-sources tuist-generate-release tuist-generate-release-cached build-ghostty build-zmx build-app build-app-demo build-snapshot-catalog run-app run-app-demo run-snapshot-catalog generate-lightning-logo-svg install-tip archive archive-xcodebuild export-archive format lint check test test-xcodebuild test-e2e test-e2e-xcodebuild test-ui test-ui-xcodebuild test-snapshots record-snapshots scan-dead-code inspect-dependencies warm-cache

ifdef CI
TUIST_INSTALL_FLAGS := --force-resolved-versions
else
TUIST_INSTALL_FLAGS :=
endif

help:  # Display this help.
	@-+echo "Run make with one of the following targets:"
	@-+echo
	@-+grep -Eh "^[a-z-]+:.*#" $(CURRENT_MAKEFILE_PATH) | sed -E 's/^(.*:)(.*#+)(.*)/  \1 @@@ \3 /' | column -t -s "@@@"

generate-project: $(TUIST_GENERATION_STAMP_DIR)/$(TUIST_GENERATE_CACHE_PROFILE) # Resolve packages and generate Xcode workspace

generate-project-sources: $(TUIST_SOURCE_GENERATION_STAMP) # Resolve packages and generate a source-only Xcode workspace

tuist-install: $(TUIST_INSTALL_STAMP)

tuist-generate: $(TUIST_CACHED_GENERATION_STAMP)

tuist-generate-sources: $(TUIST_SOURCE_GENERATION_STAMP)

tuist-generate-release: $(TUIST_SOURCE_RELEASE_GENERATION_STAMP)

tuist-generate-release-cached: $(TUIST_CACHED_RELEASE_GENERATION_STAMP)

$(TUIST_INSTALL_STAMP): $(TUIST_GENERATION_INPUTS)
	mkdir -p "$(TUIST_GENERATION_STAMP_DIR)"
	mise exec -- tuist install $(TUIST_INSTALL_FLAGS)
	touch "$@"

$(TUIST_GENERATION_STAMP_DIR)/%: $(TUIST_GENERATION_INPUTS) $(TUIST_INSTALL_STAMP)
	mkdir -p "$(TUIST_GENERATION_STAMP_DIR)"
	rm -f "$(TUIST_GENERATION_STAMP_DIR)"/*
	mise exec -- tuist generate --no-open --cache-profile "$*"
	touch "$@"

$(TUIST_SOURCE_RELEASE_GENERATION_STAMP): $(TUIST_GENERATION_INPUTS) $(TUIST_INSTALL_STAMP)
	mkdir -p "$(TUIST_GENERATION_STAMP_DIR)"
	rm -f "$(TUIST_GENERATION_STAMP_DIR)"/*
	mise exec -- tuist generate --no-open --cache-profile none --configuration Release
	touch "$@"

$(TUIST_CACHED_RELEASE_GENERATION_STAMP): $(TUIST_GENERATION_INPUTS) $(TUIST_INSTALL_STAMP)
	mkdir -p "$(TUIST_GENERATION_STAMP_DIR)"
	rm -f "$(TUIST_GENERATION_STAMP_DIR)"/*
	mise exec -- tuist generate --no-open --cache-profile "$(TUIST_BINARY_CACHE_PROFILE)" --configuration Release
	touch "$@"

build-ghostty:
	bash scripts/build-ghostty.sh

build-zmx:
	bash scripts/build-zmx.sh

build-app: tuist-generate build-ghostty build-zmx # Build the macOS app (Debug)
	bash -o pipefail -c 'xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -configuration Debug build 2>&1 | mise exec -- xcbeautify --disable-logging'

build-app-demo: tuist-generate build-ghostty build-zmx # Build the macOS app in demo mode (Debug)
	bash -o pipefail -c 'xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -configuration Debug build "SWIFT_ACTIVE_COMPILATION_CONDITIONS=\$$(inherited) SUPATERM_DEMO" 2>&1 | mise exec -- xcbeautify --disable-logging'

build-snapshot-catalog: tuist-generate build-ghostty # Build the snapshot catalog app (Debug)
	bash -o pipefail -c 'xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "supatermSnapshotCatalog" -configuration Debug build CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" 2>&1 | mise exec -- xcbeautify --disable-logging'

run-app: build-app # Build then launch (Debug) with log streaming
	@settings="$$(xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -configuration Debug -showBuildSettings -json 2>/dev/null | jq -cer --arg target "$(APP_SCHEME)" '.[] | select(.target == $$target) | .buildSettings')"; \
	build_dir="$$(echo "$$settings" | jq -r '.BUILT_PRODUCTS_DIR')"; \
	product="$$(echo "$$settings" | jq -r '.FULL_PRODUCT_NAME')"; \
	exec_name="$$(echo "$$settings" | jq -r '.EXECUTABLE_NAME')"; \
	run_id="$${SUPATERM_RUN_ID:-$$(date +%Y%m%d%H%M%S)-$$$$}"; \
	instance_name="$${SUPATERM_RUN_INSTANCE_NAME:-dev-$$(printf '%s' "$(CURRENT_MAKEFILE_DIR)" | shasum -a 256 | awk '{print substr($$1, 1, 12)}')-$$run_id}"; \
	state_home="$${SUPATERM_RUN_STATE_HOME:-$(CURRENT_MAKEFILE_DIR)/.build/run-state/$$run_id}"; \
	zmx_dir="$${SUPATERM_RUN_ZMX_DIR:-$$state_home/zmx}"; \
	mkdir -p "$$state_home" "$$zmx_dir"; \
	env -u SUPATERM_SOCKET_PATH -u SUPATERM_SURFACE_ID -u SUPATERM_TAB_ID -u SUPATERM_CLI_PATH -u SUPATERM_INSTANCE_NAME -u SUPATERM_STATE_HOME -u ZMX_DIR \
		SUPATERM_PRINT_SOCKET=1 \
		SUPATERM_INSTANCE_NAME="$$instance_name" \
		SUPATERM_STATE_HOME="$$state_home" \
		ZMX_DIR="$$zmx_dir" \
		"$$build_dir/$$product/Contents/MacOS/$$exec_name"

run-snapshot-catalog: build-snapshot-catalog # Build then launch the snapshot catalog app.
	@settings="$$(xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "supatermSnapshotCatalog" -configuration Debug -showBuildSettings -json 2>/dev/null | jq -cer --arg target "supatermSnapshotCatalog" '.[] | select(.target == $$target) | .buildSettings')"; \
	build_dir="$$(echo "$$settings" | jq -r '.BUILT_PRODUCTS_DIR')"; \
	product="$$(echo "$$settings" | jq -r '.FULL_PRODUCT_NAME')"; \
	exec_name="$$(echo "$$settings" | jq -r '.EXECUTABLE_NAME')"; \
	"$$build_dir/$$product/Contents/MacOS/$$exec_name"

generate-lightning-logo-svg: tuist-generate # Generate the Icon Composer-ready SVG logo.
	bash -o pipefail -c 'xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(LOGO_GENERATOR_SCHEME)" -configuration Debug build CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" 2>&1 | mise exec -- xcbeautify --disable-logging'
	@settings="$$(xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(LOGO_GENERATOR_SCHEME)" -configuration Debug -showBuildSettings -json 2>/dev/null | jq -cer --arg target "$(LOGO_GENERATOR_SCHEME)" '.[] | select(.target == $$target) | .buildSettings')"; \
	build_dir="$$(echo "$$settings" | jq -r '.BUILT_PRODUCTS_DIR')"; \
	exec_name="$$(echo "$$settings" | jq -r '.EXECUTABLE_NAME')"; \
	"$$build_dir/$$exec_name" --output "$(LOGO_OUTPUT)"

run-app-demo: build-app-demo # Build then launch seeded demo mode (Debug)
	@settings="$$(xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -configuration Debug -showBuildSettings -json 2>/dev/null | jq -cer --arg target "$(APP_SCHEME)" '.[] | select(.target == $$target) | .buildSettings')"; \
	build_dir="$$(echo "$$settings" | jq -r '.BUILT_PRODUCTS_DIR')"; \
	product="$$(echo "$$settings" | jq -r '.FULL_PRODUCT_NAME')"; \
	exec_name="$$(echo "$$settings" | jq -r '.EXECUTABLE_NAME')"; \
	run_id="demo"; \
	instance_name="demo-$$(printf '%s' "$(CURRENT_MAKEFILE_DIR)" | shasum -a 256 | awk '{print substr($$1, 1, 12)}')-$$run_id"; \
	state_home="$(CURRENT_MAKEFILE_DIR)/.build/run-state/$$run_id"; \
	zmx_dir="$$state_home/zmx"; \
	rm -rf "$$state_home"; \
	mkdir -p "$$state_home" "$$zmx_dir"; \
	env -u SUPATERM_SOCKET_PATH -u SUPATERM_SURFACE_ID -u SUPATERM_TAB_ID -u SUPATERM_CLI_PATH -u SUPATERM_INSTANCE_NAME -u SUPATERM_STATE_HOME -u ZMX_DIR \
		SUPATERM_PRINT_SOCKET=1 \
		SUPATERM_INSTANCE_NAME="$$instance_name" \
		SUPATERM_STATE_HOME="$$state_home" \
		ZMX_DIR="$$zmx_dir" \
		"$$build_dir/$$product/Contents/MacOS/$$exec_name"

install-tip: # Install tip build from github
	@tmpdir="$$(mktemp -d)"; \
	mount_dir=""; \
	trap 'if [ -n "$$mount_dir" ]; then hdiutil detach "$$mount_dir" -quiet >/dev/null 2>&1 || true; fi; rm -rf "$$tmpdir"' EXIT; \
	echo "Closing running SupaTerm..."; \
	pkill -x supaterm 2>/dev/null || true; \
	echo "Downloading tip release..."; \
	curl -fsSL --show-error "https://github.com/supabitapp/supaterm/releases/download/tip/supaterm.dmg" -o "$$tmpdir/supaterm.dmg"; \
	echo "Mounting disk image..."; \
	mount_dir="$$(hdiutil attach "$$tmpdir/supaterm.dmg" -nobrowse -plist | plutil -p - | awk -F '=> ' '/"mount-point"/ { gsub(/"/, "", $$2); print $$2; exit }')"; \
	if [ -z "$$mount_dir" ]; then echo "Could not mount disk image"; exit 1; fi; \
	echo "Installing application..."; \
	rm -rf "/Applications/supaterm.app"; \
	ditto "$$mount_dir/supaterm.app" "/Applications/supaterm.app"; \
	echo "Installed /Applications/supaterm.app"

archive: tuist-generate-release build-ghostty build-zmx archive-xcodebuild # Archive Release build for distribution

archive-xcodebuild:
	mkdir -p build
	bash -o pipefail -c 'xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -configuration Release -destination "generic/platform=macOS" -archivePath build/supaterm.xcarchive archive CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="$$APPLE_TEAM_ID" CODE_SIGN_IDENTITY="$$DEVELOPER_ID_IDENTITY_SHA" OTHER_CODE_SIGN_FLAGS="--timestamp" $(XCODEBUILD_FLAGS) 2>&1 | mise exec -- xcbeautify --quiet --disable-logging'

export-archive: # Export archive for distribution
	bash -o pipefail -c 'xcodebuild -exportArchive -archivePath build/supaterm.xcarchive -exportPath build/export -exportOptionsPlist build/ExportOptions.plist 2>&1 | mise exec -- xcbeautify --quiet --disable-logging'

test: tuist-generate build-ghostty build-zmx test-xcodebuild # Run the full macOS test suite

test-xcodebuild:
	@bash -o pipefail -c 'xcodebuild test -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -destination "platform=macOS" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" 2>&1 | mise exec -- xcbeautify --disable-logging'

test-snapshots: tuist-generate build-ghostty # Run snapshot tests.
	@bash -o pipefail -c 'xcodebuild test -workspace "$(PROJECT_WORKSPACE)" -scheme "supatermSnapshots" -destination "platform=macOS" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" 2>&1 | mise exec -- xcbeautify --disable-logging'

test-e2e: tuist-generate build-ghostty build-zmx test-e2e-xcodebuild # Run end-to-end tests against the real app.

test-e2e-xcodebuild:
	@if [ -n "$(strip $(E2E_RESULT_BUNDLE_PATH))" ]; then rm -rf "$(E2E_RESULT_BUNDLE_PATH)"; fi
	@if [ -t 1 ]; then \
		bash -o pipefail -c 'xcodebuild test -workspace "$(PROJECT_WORKSPACE)" -scheme "supatermE2E" -destination "platform=macOS" $(E2E_RESULT_BUNDLE_FLAGS) CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" 2>&1 | mise exec -- xcbeautify --disable-logging'; \
	else \
		xcodebuild test -workspace "$(PROJECT_WORKSPACE)" -scheme "supatermE2E" -destination "platform=macOS" $(E2E_RESULT_BUNDLE_FLAGS) CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=""; \
	fi

test-ui: tuist-generate build-ghostty build-zmx test-ui-xcodebuild

test-ui-xcodebuild:
	@if [ -n "$(strip $(UI_RESULT_BUNDLE_PATH))" ]; then rm -rf "$(UI_RESULT_BUNDLE_PATH)"; fi
	@if [ -t 1 ]; then \
		bash -o pipefail -c 'xcodebuild test -workspace "$(PROJECT_WORKSPACE)" -scheme "supatermUITests" -destination "platform=macOS" $(UI_RESULT_BUNDLE_FLAGS) 2>&1 | mise exec -- xcbeautify --disable-logging'; \
	else \
		xcodebuild test -workspace "$(PROJECT_WORKSPACE)" -scheme "supatermUITests" -destination "platform=macOS" $(UI_RESULT_BUNDLE_FLAGS); \
	fi

record-snapshots: tuist-generate build-ghostty # Record snapshot references.
	TEST_RUNNER_SNAPSHOT_TESTING_RECORD=all xcodebuild test -workspace "$(PROJECT_WORKSPACE)" -scheme "supatermSnapshots" -destination "platform=macOS" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=""

scan-dead-code: tuist-generate build-ghostty build-zmx
	mise exec -- periphery scan

format: # Format code with swift format (local only)
	swift format -p --in-place --recursive --configuration ./.swift-format.json SupaTheme SupaThemeLogoGenerator SupatermCLIShared SPCLI sp supaterm supatermTests supatermSnapshotTests supatermE2E supatermUITests

lint: # Lint code with swiftlint
	mise exec -- swiftlint lint --quiet --config .swiftlint.yml

inspect-dependencies: $(TUIST_INSTALL_STAMP) # Check for implicit and redundant Tuist dependencies
	mise exec -- tuist inspect dependencies

warm-cache: $(TUIST_INSTALL_STAMP) # Warm Tuist module cache for external dependencies
	mise exec -- tuist cache warm --configuration "$(TUIST_CACHE_CONFIGURATION)" --cache-profile "$(TUIST_BINARY_CACHE_PROFILE)"

check: format lint # Format and lint
