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
SP_SCHEME := sp
SCHEMA_OUTPUT_PATH := $(CURRENT_MAKEFILE_DIR)/../supaterm.com/public/data/supaterm-settings.schema.json
TUIST_GENERATION_STAMP_DIR := $(CURRENT_MAKEFILE_DIR)/.build/.tuist-generated-stamps
TUIST_INSTALL_STAMP := $(TUIST_GENERATION_STAMP_DIR)/.installed
TUIST_DEVELOPMENT_GENERATION_STAMP := $(TUIST_GENERATION_STAMP_DIR)/development
TUIST_SOURCE_GENERATION_STAMP := $(TUIST_GENERATION_STAMP_DIR)/none
TUIST_SOURCE_RELEASE_GENERATION_STAMP := $(TUIST_GENERATION_STAMP_DIR)/none-release
TUIST_GENERATION_INPUTS := Project.swift Tuist.swift Tuist/Package.swift Tuist/Package.resolved Configurations/Project.xcconfig ../../mise.toml
TUIST_GENERATE_CACHE_PROFILE ?= development
TUIST_CACHE_CONFIGURATION ?= Debug
XCODEBUILD_FLAGS ?=
.DEFAULT_GOAL := help
.PHONY: build-app run-app install-tip archive export-archive format lint check test inspect-dependencies warm-cache generate-settings-schema

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

build-app: $(TUIST_DEVELOPMENT_GENERATION_STAMP) # Build the macOS app (Debug)
	bash -o pipefail -c 'xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -configuration Debug build -skipMacroValidation 2>&1 | mise exec -- xcbeautify --disable-logging'

generate-settings-schema: $(TUIST_DEVELOPMENT_GENERATION_STAMP) # Build the CLI and write the hosted settings schema
	bash -o pipefail -c 'xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(SP_SCHEME)" -configuration Debug build CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" -skipMacroValidation 2>&1 | mise exec -- xcbeautify --disable-logging'
	@settings="$$(xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(SP_SCHEME)" -configuration Debug -showBuildSettings -json 2>/dev/null)"; \
	build_dir="$$(echo "$$settings" | jq -r ".[0].buildSettings.BUILT_PRODUCTS_DIR")"; \
	executable="$$build_dir/$(SP_SCHEME)"; \
	destination="$(SCHEMA_OUTPUT_PATH)"; \
	destination_dir="$$(dirname "$$destination")"; \
	temp_path="$$(mktemp "$${TMPDIR:-/tmp}/supaterm-settings-schema.XXXXXX")"; \
	trap 'rm -f "$$temp_path"' EXIT; \
	mkdir -p "$$destination_dir"; \
	env -u SUPATERM_CLI_PATH "$$executable" internal generate-settings-schema > "$$temp_path"; \
	if [ -f "$$destination" ] && cmp -s "$$temp_path" "$$destination"; then \
		exit 0; \
	fi; \
	mv "$$temp_path" "$$destination"

run-app: build-app # Build then launch (Debug) with log streaming
	@settings="$$(xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -configuration Debug -showBuildSettings -json 2>/dev/null)"; \
	build_dir="$$(echo "$$settings" | jq -r '.[0].buildSettings.BUILT_PRODUCTS_DIR')"; \
	product="$$(echo "$$settings" | jq -r '.[0].buildSettings.FULL_PRODUCT_NAME')"; \
	exec_name="$$(echo "$$settings" | jq -r '.[0].buildSettings.EXECUTABLE_NAME')"; \
	SUPATERM_PRINT_SOCKET=1 "$$build_dir/$$product/Contents/MacOS/$$exec_name"

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

archive: $(TUIST_SOURCE_RELEASE_GENERATION_STAMP) # Archive Release build for distribution
	mkdir -p build
	bash -o pipefail -c 'xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -configuration Release -destination "generic/platform=macOS" -archivePath build/supaterm.xcarchive archive CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="$$APPLE_TEAM_ID" CODE_SIGN_IDENTITY="$$DEVELOPER_ID_IDENTITY_SHA" OTHER_CODE_SIGN_FLAGS="--timestamp" $(XCODEBUILD_FLAGS) -skipMacroValidation 2>&1 | mise exec -- xcbeautify --quiet --disable-logging'

export-archive: # Export archive for distribution
	bash -o pipefail -c 'xcodebuild -exportArchive -archivePath build/supaterm.xcarchive -exportPath build/export -exportOptionsPlist build/ExportOptions.plist 2>&1 | mise exec -- xcbeautify --quiet --disable-logging'

test: $(TUIST_DEVELOPMENT_GENERATION_STAMP) # Run the full macOS test suite
	@if [ -t 1 ]; then \
		bash -o pipefail -c 'xcodebuild test -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -destination "platform=macOS" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" -skipMacroValidation 2>&1 | mise exec -- xcbeautify --disable-logging'; \
	else \
		xcodebuild test -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -destination "platform=macOS" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" -skipMacroValidation; \
	fi

format: # Format code with swift format (local only)
	swift format -p --in-place --recursive --configuration ./.swift-format.json supaterm supatermTests

lint: # Lint code with swiftlint
	mise exec -- swiftlint lint --quiet --config .swiftlint.yml

inspect-dependencies: $(TUIST_INSTALL_STAMP) # Check for implicit and redundant Tuist dependencies
	mise exec -- tuist inspect dependencies

warm-cache: $(TUIST_INSTALL_STAMP) # Warm Tuist module cache for the full cacheable graph
	mise exec -- tuist cache warm --configuration $(TUIST_CACHE_CONFIGURATION)

check: format lint # Format and lint
