TUIST_ROOT_DIR ?= $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
TUIST_INSTALL_STAMP := $(TUIST_ROOT_DIR)/.build/.tuist-installed
TUIST_INSTALL_INPUTS := $(TUIST_ROOT_DIR)/../mise.toml $(TUIST_ROOT_DIR)/Tuist.mk $(TUIST_ROOT_DIR)/Tuist.swift $(TUIST_ROOT_DIR)/Tuist/Package.swift $(TUIST_ROOT_DIR)/Tuist/Package.resolved
TUIST_CACHE_START_ONLY ?= 0
TUIST_GENERATION_STAMP_DIR ?=
TUIST_XCODE_CACHE_SOCKET := $(HOME)/.local/state/tuist/supabitapp_supaterm.sock

ifdef CI
TUIST_INSTALL_FLAGS := --force-resolved-versions
else
TUIST_INSTALL_FLAGS :=
endif

.PHONY: tuist-install tuist-cache-setup tuist-cache-start

tuist-install: $(TUIST_INSTALL_STAMP)

tuist-cache-setup:
	@if [ "$$(uname -s)" != Darwin ] || /usr/sbin/lsof "$(TUIST_XCODE_CACHE_SOCKET)" >/dev/null 2>&1; then exit 0; fi; \
		if ! mise exec -- tuist auth whoami >/dev/null 2>&1; then exit 0; fi; \
		mkdir -p "$(dir $(TUIST_XCODE_CACHE_SOCKET))"; \
		/usr/bin/lockf -k "$(TUIST_XCODE_CACHE_SOCKET).setup.lock" $(MAKE) -f "$(TUIST_ROOT_DIR)/Tuist.mk" tuist-cache-start TUIST_CACHE_START_ONLY=1 TUIST_GENERATION_STAMP_DIR="$(TUIST_GENERATION_STAMP_DIR)"

tuist-cache-start:
	@if /usr/sbin/lsof "$(TUIST_XCODE_CACHE_SOCKET)" >/dev/null 2>&1; then exit 0; fi; \
		mise exec -- tuist teardown cache --path "$(TUIST_ROOT_DIR)"; \
		mise exec -- tuist setup cache --path "$(TUIST_ROOT_DIR)"; \
		for attempt in $$(seq 1 300); do \
			if /usr/sbin/lsof "$(TUIST_XCODE_CACHE_SOCKET)" >/dev/null 2>&1; then break; fi; \
			sleep 0.1; \
		done; \
		/usr/sbin/lsof "$(TUIST_XCODE_CACHE_SOCKET)" >/dev/null 2>&1; \
		if [ -n "$(TUIST_GENERATION_STAMP_DIR)" ]; then rm -f "$(TUIST_GENERATION_STAMP_DIR)"/*; fi

$(TUIST_INSTALL_STAMP): $(TUIST_INSTALL_INPUTS)
	mkdir -p "$(dir $(TUIST_INSTALL_STAMP))"
	cd "$(TUIST_ROOT_DIR)" && mise exec -- tuist install $(TUIST_INSTALL_FLAGS)
	touch "$@"

ifneq ($(TUIST_CACHE_START_ONLY),1)
ifneq ($(strip $(TUIST_GENERATION_STAMP_DIR)),)
$(TUIST_GENERATION_STAMP_DIR)/%: $(TUIST_GENERATION_INPUTS) $(TUIST_INSTALL_STAMP) | tuist-cache-setup
	mkdir -p "$(TUIST_GENERATION_STAMP_DIR)"
	rm -f "$(TUIST_GENERATION_STAMP_DIR)"/*
	mise exec -- tuist generate --no-open --cache-profile "$*" --configuration "$(TUIST_CONFIGURATION)"
	touch "$@"
endif
endif
