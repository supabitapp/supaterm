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
TUIST_ROOT_DIR := $(abspath $(CURRENT_MAKEFILE_DIR)/..)
PROJECT_WORKSPACE := $(CURRENT_MAKEFILE_DIR)/supaterm.xcworkspace
APP_SCHEME := supaterm
MACOS_DESTINATION := platform=macOS,arch=$(shell uname -m)
PERIPHERY_SCHEMES := supaterm supatermSnapshotCatalog supatermE2E
PERIPHERY_DERIVED_DATA_PATH := $(CURRENT_MAKEFILE_DIR)/.build/periphery-derived-data
PERIPHERY_INDEX_STORE_PATH := $(PERIPHERY_DERIVED_DATA_PATH)/Index.noindex/DataStore
LOGO_GENERATOR_SCHEME := SupaThemeLogoGenerator
TUIST_GENERATION_STAMP_DIR := $(CURRENT_MAKEFILE_DIR)/.build/.tuist-generated-stamps
TUIST_BINARY_CACHE_PROFILE ?= only-external
TUIST_CACHED_GENERATION_STAMP := $(TUIST_GENERATION_STAMP_DIR)/$(TUIST_BINARY_CACHE_PROFILE)
TUIST_SOURCE_GENERATION_STAMP := $(TUIST_GENERATION_STAMP_DIR)/none
TUIST_CACHED_RELEASE_GENERATION_STAMP := $(TUIST_GENERATION_STAMP_DIR)/$(TUIST_BINARY_CACHE_PROFILE)-release
TUIST_SOURCE_RELEASE_GENERATION_STAMP := $(TUIST_GENERATION_STAMP_DIR)/none-release
TUIST_GENERATION_INPUTS := Project.swift ../Tuist.mk ../Tuist.swift ../Tuist/Package.swift ../Tuist/Package.resolved ../shared/Project.swift Configurations/Project.xcconfig ../Configurations/Versions.xcconfig ../../mise.toml
TUIST_GENERATE_CACHE_PROFILE ?= $(TUIST_BINARY_CACHE_PROFILE)
TUIST_CONFIGURATION ?= Debug
include ../Tuist.mk
XCODEBUILD_FLAGS ?=
E2E_RESULT_BUNDLE_PATH ?=
E2E_RESULT_BUNDLE_FLAGS := $(if $(strip $(E2E_RESULT_BUNDLE_PATH)),-resultBundlePath "$(E2E_RESULT_BUNDLE_PATH)",)
E2E_AGENT ?= none
CODEX_E2E_TOOL := codex@0.150.1
CLAUDE_E2E_TOOL := npm:@anthropic-ai/claude-code-darwin-arm64@2.1.235
PI_E2E_TOOL := npm:@mariozechner/pi-coding-agent@0.73.1
LOGO_OUTPUT ?= /tmp/supaterm-lightning-logo.svg
APP_RUN_ENV := SUPATERM_VERBOSE_LOGGING=1
RUN_STATE_ROOT := $(CURRENT_MAKEFILE_DIR)/.build/run-state
.DEFAULT_GOAL := help
.PHONY: tuist-install tuist-generate tuist-generate-sources tuist-generate-release tuist-generate-release-cached build-ghostty build-zmx build-ap build-app build-app-demo build-snapshot-catalog run-app run-app-demo run-snapshot-catalog generate-lightning-logo-svg install-tip archive archive-xcodebuild export-archive format lint check test test-xcodebuild test-e2e test-e2e-xcodebuild test-snapshots record-snapshots scan-dead-code inspect-dependencies warm-cache

help:  # Display this help.
	@-+echo "Run make with one of the following targets:"
	@-+echo
	@-+grep -Eh "^[a-z-]+:.*#" $(CURRENT_MAKEFILE_PATH) | sed -E 's/^(.*:)(.*#+)(.*)/  \1 @@@ \3 /' | column -t -s "@@@"

generate-project: $(TUIST_GENERATION_STAMP_DIR)/$(TUIST_GENERATE_CACHE_PROFILE) # Resolve packages and generate Xcode workspace

generate-project-sources: $(TUIST_SOURCE_GENERATION_STAMP) # Resolve packages and generate a source-only Xcode workspace

tuist-generate: $(TUIST_CACHED_GENERATION_STAMP)

tuist-generate-sources: $(TUIST_SOURCE_GENERATION_STAMP)

tuist-generate-release: $(TUIST_SOURCE_RELEASE_GENERATION_STAMP)

tuist-generate-release-cached: $(TUIST_CACHED_RELEASE_GENERATION_STAMP)

$(TUIST_SOURCE_RELEASE_GENERATION_STAMP): $(TUIST_GENERATION_INPUTS) $(TUIST_INSTALL_STAMP) | tuist-cache-setup
	mkdir -p "$(TUIST_GENERATION_STAMP_DIR)"
	rm -f "$(TUIST_GENERATION_STAMP_DIR)"/*
	mise exec -- tuist generate --no-open --cache-profile none --configuration Release
	touch "$@"

$(TUIST_CACHED_RELEASE_GENERATION_STAMP): $(TUIST_GENERATION_INPUTS) $(TUIST_INSTALL_STAMP) | tuist-cache-setup
	mkdir -p "$(TUIST_GENERATION_STAMP_DIR)"
	rm -f "$(TUIST_GENERATION_STAMP_DIR)"/*
	mise exec -- tuist generate --no-open --cache-profile "$(TUIST_BINARY_CACHE_PROFILE)" --configuration Release
	touch "$@"

build-ghostty:
	bash scripts/build-ghostty.sh

build-zmx:
	bash scripts/build-zmx.sh

build-ap:
	bash scripts/build-ap.sh

build-app: tuist-generate build-ghostty build-zmx build-ap # Build the macOS app (Debug)
	bash -o pipefail -c 'xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -configuration Debug build 2>&1 | mise exec -- xcbeautify --disable-logging'

build-app-demo: tuist-generate build-ghostty build-zmx build-ap # Build the macOS app in demo mode (Debug)
	bash -o pipefail -c 'xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -configuration Debug build "SWIFT_ACTIVE_COMPILATION_CONDITIONS=\$$(inherited) SUPATERM_DEMO" 2>&1 | mise exec -- xcbeautify --disable-logging'

build-snapshot-catalog: tuist-generate build-ghostty # Build the snapshot catalog app (Debug)
	bash -o pipefail -c 'xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "supatermSnapshotCatalog" -configuration Debug build CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" 2>&1 | mise exec -- xcbeautify --disable-logging'

run-app: build-app # Build then launch (Debug) with log streaming
	@settings="$$(xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -configuration Debug -showBuildSettings -json 2>/dev/null | jq -cer --arg target "$(APP_SCHEME)" '.[] | select(.target == $$target) | .buildSettings')"; \
	build_dir="$$(echo "$$settings" | jq -r '.BUILT_PRODUCTS_DIR')"; \
	product="$$(echo "$$settings" | jq -r '.FULL_PRODUCT_NAME')"; \
	exec_name="$$(echo "$$settings" | jq -r '.EXECUTABLE_NAME')"; \
	instance_name="$${SUPATERM_RUN_INSTANCE_NAME:-dev-$$(printf '%s' "$(CURRENT_MAKEFILE_DIR)" | shasum -a 256 | awk '{print substr($$1, 1, 12)}')}"; \
	state_home="$${SUPATERM_RUN_STATE_HOME:-$(RUN_STATE_ROOT)/dev}"; \
	mkdir -p "$$state_home"; \
	env -u SUPATERM_SOCKET_PATH -u SUPATERM_SURFACE_ID -u SUPATERM_TAB_ID -u SUPATERM_CLI_PATH -u SUPATERM_INSTANCE_NAME -u SUPATERM_STATE_HOME -u ZMX_DIR -u ZMX_SESSION -u ZMX_SESSION_PREFIX \
		$(APP_RUN_ENV) \
		SUPATERM_PRINT_SOCKET=1 \
		SUPATERM_INSTANCE_NAME="$$instance_name" \
		SUPATERM_STATE_HOME="$$state_home" \
		"$$build_dir/$$product/Contents/MacOS/$$exec_name"

run-snapshot-catalog: build-snapshot-catalog # Build then launch the snapshot catalog app.
	@settings="$$(xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "supatermSnapshotCatalog" -configuration Debug -showBuildSettings -json 2>/dev/null | jq -cer --arg target "supatermSnapshotCatalog" '.[] | select(.target == $$target) | .buildSettings')"; \
	build_dir="$$(echo "$$settings" | jq -r '.BUILT_PRODUCTS_DIR')"; \
	product="$$(echo "$$settings" | jq -r '.FULL_PRODUCT_NAME')"; \
	exec_name="$$(echo "$$settings" | jq -r '.EXECUTABLE_NAME')"; \
	env $(APP_RUN_ENV) "$$build_dir/$$product/Contents/MacOS/$$exec_name"

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
	instance_name="demo-$$(printf '%s' "$(CURRENT_MAKEFILE_DIR)" | shasum -a 256 | awk '{print substr($$1, 1, 12)}')"; \
	state_home="$(RUN_STATE_ROOT)/demo"; \
	mkdir -p "$$state_home"; \
	env -u SUPATERM_SOCKET_PATH -u SUPATERM_SURFACE_ID -u SUPATERM_TAB_ID -u SUPATERM_CLI_PATH -u SUPATERM_INSTANCE_NAME -u SUPATERM_STATE_HOME -u ZMX_DIR -u ZMX_SESSION -u ZMX_SESSION_PREFIX \
		$(APP_RUN_ENV) \
		SUPATERM_PRINT_SOCKET=1 \
		SUPATERM_INSTANCE_NAME="$$instance_name" \
		SUPATERM_STATE_HOME="$$state_home" \
		"$$build_dir/$$product/Contents/MacOS/$$exec_name"

install-tip: # Install tip build from github
	@tmpdir="$$(mktemp -d)"; \
	mount_dir=""; \
	trap 'if [ -n "$$mount_dir" ]; then hdiutil detach "$$mount_dir" -quiet >/dev/null 2>&1 || true; fi; rm -rf "$$tmpdir"' EXIT; \
	echo "Closing running Supaterm..."; \
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

archive: tuist-generate-release build-ghostty build-zmx build-ap archive-xcodebuild # Archive Release build for distribution

archive-xcodebuild:
	mkdir -p build
	bash -o pipefail -c 'xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -configuration Release -destination "generic/platform=macOS" -archivePath build/supaterm.xcarchive archive CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="$$APPLE_TEAM_ID" CODE_SIGN_IDENTITY="$$DEVELOPER_ID_IDENTITY_SHA" OTHER_CODE_SIGN_FLAGS="--timestamp" $(XCODEBUILD_FLAGS) 2>&1 | mise exec -- xcbeautify --quiet --disable-logging'

export-archive: # Export archive for distribution
	bash -o pipefail -c 'xcodebuild -exportArchive -archivePath build/supaterm.xcarchive -exportPath build/export -exportOptionsPlist build/ExportOptions.plist 2>&1 | mise exec -- xcbeautify --quiet --disable-logging'

test: tuist-generate build-ghostty build-zmx build-ap test-xcodebuild # Run the full macOS test suite

test-xcodebuild:
	@bash -o pipefail -c 'xcodebuild test -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -destination "$(MACOS_DESTINATION)" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" 2>&1 | mise exec -- xcbeautify --disable-logging'

test-snapshots: tuist-generate build-ghostty # Run snapshot tests.
	@bash -o pipefail -c 'xcodebuild test -workspace "$(PROJECT_WORKSPACE)" -scheme "supatermSnapshots" -destination "$(MACOS_DESTINATION)" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" 2>&1 | mise exec -- xcbeautify --disable-logging'

test-e2e: tuist-generate build-ghostty build-zmx build-ap test-e2e-xcodebuild # Run end-to-end tests against the real app.

test-e2e-xcodebuild:
	@if [ -n "$(strip $(E2E_RESULT_BUNDLE_PATH))" ]; then rm -rf "$(E2E_RESULT_BUNDLE_PATH)"; fi
	@agent="$(E2E_AGENT)"; \
	case "$$agent" in none | codex | claude | pi | all) ;; *) echo "Unknown E2E agent: $$agent" >&2; exit 1 ;; esac; \
	includes_agent() { [ "$$agent" = all ] || [ "$$agent" = "$$1" ]; }; \
	codex_binary=""; \
	claude_binary=""; \
	pi_binary=""; \
	if includes_agent codex; then \
		codex_binary="$${CODEX_E2E_BINARY:-$$(mise x "$(CODEX_E2E_TOOL)" -- which codex)}"; \
		test -x "$$codex_binary" || exit 1; \
	fi; \
	if includes_agent claude; then \
		claude_binary="$${CLAUDE_E2E_BINARY:-}"; \
		if [ -z "$$claude_binary" ]; then \
			claude_tool="$(CLAUDE_E2E_TOOL)"; \
			mise x "$$claude_tool" -- true || exit 1; \
			claude_package="$${claude_tool#npm:}"; \
			claude_package="$${claude_package%@*}"; \
			claude_binary="$$(mise where "$$claude_tool")/node_modules/$$claude_package/claude"; \
		fi; \
		test -x "$$claude_binary" || exit 1; \
	fi; \
	if includes_agent pi; then \
		pi_binary="$${PI_E2E_BINARY:-$$(mise x "$(PI_E2E_TOOL)" -- which pi)}"; \
		test -x "$$pi_binary" || exit 1; \
	fi; \
	xcodebuild_command=(xcodebuild test -workspace "$(PROJECT_WORKSPACE)" -scheme "supatermE2E" -destination "$(MACOS_DESTINATION)" $(E2E_RESULT_BUNDLE_FLAGS) $(XCODEBUILD_FLAGS) CLAUDE_E2E_BINARY="$$claude_binary" CODEX_E2E_BINARY="$$codex_binary" PI_E2E_BINARY="$$pi_binary" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=""); \
	if [ -t 1 ]; then \
		"$${xcodebuild_command[@]}" 2>&1 | mise exec -- xcbeautify --disable-logging; \
	else \
		"$${xcodebuild_command[@]}"; \
	fi

record-snapshots: tuist-generate build-ghostty # Record snapshot references.
	TEST_RUNNER_SNAPSHOT_TESTING_RECORD=all xcodebuild test -workspace "$(PROJECT_WORKSPACE)" -scheme "supatermSnapshots" -destination "$(MACOS_DESTINATION)" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=""

scan-dead-code: tuist-generate build-ghostty build-zmx build-ap
	for scheme in $(PERIPHERY_SCHEMES); do \
		xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$$scheme" -parallelizeTargets -derivedDataPath "$(PERIPHERY_DERIVED_DATA_PATH)" -quiet build-for-testing CODE_SIGNING_ALLOWED=NO ENABLE_BITCODE=NO DEBUG_INFORMATION_FORMAT=dwarf COMPILER_INDEX_STORE_ENABLE=YES INDEX_ENABLE_DATA_STORE=YES -destination "$(MACOS_DESTINATION)"; \
	done
	mise exec -- periphery scan --skip-build --schemes $(PERIPHERY_SCHEMES) --index-store-path "$(PERIPHERY_INDEX_STORE_PATH)"

format: # Format code with swift format (local only)
	swift format -p --in-place --recursive --configuration ../.swift-format.json SupaThemeLogoGenerator SupatermCLIShared SupatermTestSupport SPCLI sp supaterm supatermTests supatermSnapshotTests supatermE2E supatermUITests

lint: # Lint code with swiftlint
	"$$(mise which swiftlint)" lint --quiet --config ../.swiftlint.yml SupaThemeLogoGenerator supaterm supatermTests supatermSnapshotTests supatermE2E supatermUITests

inspect-dependencies: $(TUIST_INSTALL_STAMP) # Check for implicit and redundant Tuist dependencies
	mise exec -- tuist inspect dependencies

warm-cache: $(TUIST_INSTALL_STAMP) # Warm Tuist module cache for external dependencies
	mise exec -- tuist cache warm --configuration "$(TUIST_CONFIGURATION)" --cache-profile "$(TUIST_BINARY_CACHE_PROFILE)"

check: format lint # Format and lint
