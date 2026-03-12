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
TUIST_GENERATION_STAMP := $(PROJECT_WORKSPACE)/.tuist-generated-stamp
TUIST_GENERATION_INPUTS := Project.swift Tuist.swift Tuist/Package.swift Tuist/Package.resolved Configurations/Project.xcconfig mise.toml
.DEFAULT_GOAL := help
.PHONY: generate-project build-app run-app format lint check test

ifeq ($(CI),)
TUIST_INSTALL_FLAGS :=
else
TUIST_INSTALL_FLAGS := --force-resolved-versions
endif

help:  # Display this help.
	@-+echo "Run make with one of the following targets:"
	@-+echo
	@-+grep -Eh "^[a-z-]+:.*#" $(CURRENT_MAKEFILE_PATH) | sed -E 's/^(.*:)(.*#+)(.*)/  \1 @@@ \3 /' | column -t -s "@@@"

generate-project: $(TUIST_GENERATION_STAMP) # Resolve packages and generate Xcode workspace

$(TUIST_GENERATION_STAMP): $(TUIST_GENERATION_INPUTS)
	mise exec -- tuist install $(TUIST_INSTALL_FLAGS)
	mise exec -- tuist generate --no-open
	touch "$@"

build-app: $(TUIST_GENERATION_STAMP) # Build the macOS app (Debug)
	bash -o pipefail -c 'xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -configuration Debug build -skipMacroValidation 2>&1 | mise exec -- xcsift -qw --format toon'

run-app: build-app # Build then launch (Debug) with log streaming
	@settings="$$(xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -configuration Debug -showBuildSettings -json 2>/dev/null)"; \
	build_dir="$$(echo "$$settings" | jq -r '.[0].buildSettings.BUILT_PRODUCTS_DIR')"; \
	product="$$(echo "$$settings" | jq -r '.[0].buildSettings.FULL_PRODUCT_NAME')"; \
	exec_name="$$(echo "$$settings" | jq -r '.[0].buildSettings.EXECUTABLE_NAME')"; \
	"$$build_dir/$$product/Contents/MacOS/$$exec_name"

test: $(TUIST_GENERATION_STAMP)
	bash -o pipefail -c 'xcodebuild test -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -destination "platform=macOS" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" -skipMacroValidation 2>&1 | mise exec -- xcsift -qw --format toon'

format: # Format code with swift-format (local only)
	swift-format -p --in-place --recursive --configuration ./.swift-format.json supaterm supatermTests

lint: # Lint code with swiftlint
	mise exec -- swiftlint lint --quiet --config .swiftlint.yml

check: format lint # Format and lint
