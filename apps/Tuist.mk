TUIST_ROOT_DIR ?= $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
TUIST_INSTALL_STAMP := $(TUIST_ROOT_DIR)/.build/.tuist-installed
TUIST_INSTALL_INPUTS := $(TUIST_ROOT_DIR)/../mise.toml $(TUIST_ROOT_DIR)/Tuist.mk $(TUIST_ROOT_DIR)/Tuist.swift $(TUIST_ROOT_DIR)/Tuist/Package.swift $(TUIST_ROOT_DIR)/Tuist/Package.resolved
XCODE_VERSION_FILE := $(TUIST_ROOT_DIR)/../.xcode-version
XCODE_BUILD_VERSION_FILE := $(TUIST_ROOT_DIR)/../.xcode-build-version
TUIST_GENERATION_STAMP_DIR ?=

ifdef CI
TUIST_INSTALL_FLAGS := --force-resolved-versions
else
TUIST_INSTALL_FLAGS :=
endif

.PHONY: xcode-version-check tuist-install

xcode-version-check:
	@if [ "$$(uname -s)" != Darwin ]; then exit 0; fi; \
		expected="$$(tr -d '[:space:]' < "$(XCODE_VERSION_FILE)")"; \
		expected_build="$$(tr -d '[:space:]' < "$(XCODE_BUILD_VERSION_FILE)")"; \
		actual="$$(xcodebuild -version | awk 'NR == 1 { print $$2 }')"; \
		actual_build="$$(xcodebuild -version | awk 'NR == 2 { print $$3 }')"; \
		if [ "$$actual" != "$$expected" ] || [ "$$actual_build" != "$$expected_build" ]; then \
			echo "error: Supaterm requires Xcode $$expected ($$expected_build), but xcode-select is using Xcode $$actual ($$actual_build)" >&2; \
			echo "Select /Applications/Xcode_$$expected.app/Contents/Developer and retry." >&2; \
			exit 1; \
		fi

tuist-install: xcode-version-check $(TUIST_INSTALL_STAMP)

$(TUIST_INSTALL_STAMP): $(TUIST_INSTALL_INPUTS) | xcode-version-check
	mkdir -p "$(dir $(TUIST_INSTALL_STAMP))"
	cd "$(TUIST_ROOT_DIR)" && mise exec -- tuist install $(TUIST_INSTALL_FLAGS)
	touch "$@"

ifneq ($(strip $(TUIST_GENERATION_STAMP_DIR)),)
$(TUIST_GENERATION_STAMP_DIR)/%: $(TUIST_GENERATION_INPUTS) $(TUIST_INSTALL_STAMP)
	mkdir -p "$(TUIST_GENERATION_STAMP_DIR)"
	rm -f "$(TUIST_GENERATION_STAMP_DIR)"/*
	mise exec -- tuist generate --no-open --cache-profile "$*" --configuration "$(TUIST_CONFIGURATION)"
	touch "$@"
endif
