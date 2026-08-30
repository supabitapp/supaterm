.ONESHELL:
SHELL := bash
.SHELLFLAGS := -e -u -c -o pipefail
.DELETE_ON_ERROR:
MAKEFLAGS += --warn-undefined-variables
MAKEFLAGS += --no-builtin-rules

CURRENT_MAKEFILE_PATH := $(abspath $(lastword $(MAKEFILE_LIST)))
CURRENT_MAKEFILE_DIR := $(patsubst %/,%,$(dir $(CURRENT_MAKEFILE_PATH)))
PROJECT_WORKSPACE := $(CURRENT_MAKEFILE_DIR)/SupatermIOS.xcworkspace
APP_SCHEME := Supaterm iOS
IOS_SIMULATOR ?= iPhone 17 Pro
IOS_DESTINATION := platform=iOS Simulator,name=$(IOS_SIMULATOR),OS=latest
TUIST_GENERATION_STAMP_DIR := $(CURRENT_MAKEFILE_DIR)/.build/.tuist-generated-stamps
TUIST_INSTALL_STAMP := $(TUIST_GENERATION_STAMP_DIR)/.installed
TUIST_BINARY_CACHE_PROFILE ?= only-external
TUIST_CACHED_GENERATION_STAMP := $(TUIST_GENERATION_STAMP_DIR)/$(TUIST_BINARY_CACHE_PROFILE)
TUIST_SOURCE_GENERATION_STAMP := $(TUIST_GENERATION_STAMP_DIR)/none
TUIST_GENERATION_INPUTS := Project.swift ../Tuist.swift ../Tuist/Package.swift ../Tuist/Package.resolved ../shared/Project.swift Configurations/Project.xcconfig ../Configurations/Versions.xcconfig ../../mise.toml
TUIST_GENERATE_CACHE_PROFILE ?= $(TUIST_BINARY_CACHE_PROFILE)
TUIST_CONFIGURATION ?= Debug
.DEFAULT_GOAL := help
.PHONY: help tuist-install tuist-generate tuist-generate-sources build-app format lint check inspect-dependencies warm-cache xcode-open

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

$(TUIST_INSTALL_STAMP): $(TUIST_GENERATION_INPUTS)
	mkdir -p "$(TUIST_GENERATION_STAMP_DIR)"
	mise exec -- tuist install $(TUIST_INSTALL_FLAGS)
	touch "$@"

$(TUIST_GENERATION_STAMP_DIR)/%: $(TUIST_GENERATION_INPUTS) $(TUIST_INSTALL_STAMP)
	mkdir -p "$(TUIST_GENERATION_STAMP_DIR)"
	rm -f "$(TUIST_GENERATION_STAMP_DIR)"/*
	mise exec -- tuist generate --no-open --cache-profile "$*" --configuration "$(TUIST_CONFIGURATION)"
	touch "$@"

build-app: tuist-generate # Build the iOS app for a simulator (Debug)
	bash -o pipefail -c 'xcodebuild -workspace "$(PROJECT_WORKSPACE)" -scheme "$(APP_SCHEME)" -configuration Debug -destination "$(IOS_DESTINATION)" build CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" 2>&1 | mise exec -- xcbeautify --disable-logging'

format: # Format iOS app code
	swift format -p --in-place --recursive --configuration ../.swift-format.json Sources Project.swift

lint: # Lint iOS app code
	"$$(mise which swiftlint)" lint --quiet --config ../.swiftlint.yml Sources

check: format lint # Run local formatting and linting for the iOS app

inspect-dependencies: $(TUIST_INSTALL_STAMP) # Check the iOS Tuist graph for implicit dependencies
	mise exec -- tuist inspect dependencies

warm-cache: $(TUIST_INSTALL_STAMP) # Warm the iOS external Tuist cache
	mise exec -- tuist cache warm --configuration "$(TUIST_CONFIGURATION)" --cache-profile "$(TUIST_BINARY_CACHE_PROFILE)"

xcode-open: tuist-generate # Open the iOS Xcode workspace
	open "$(PROJECT_WORKSPACE)"
