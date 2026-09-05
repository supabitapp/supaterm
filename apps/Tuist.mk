TUIST_ROOT_DIR ?= $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
TUIST_INSTALL_STAMP := $(TUIST_ROOT_DIR)/.build/.tuist-installed
TUIST_INSTALL_INPUTS := $(TUIST_ROOT_DIR)/../mise.toml $(TUIST_ROOT_DIR)/Tuist.mk $(TUIST_ROOT_DIR)/Tuist.swift $(TUIST_ROOT_DIR)/Tuist/Package.swift $(TUIST_ROOT_DIR)/Tuist/Package.resolved
TUIST_GENERATION_STAMP_DIR ?=

ifdef CI
TUIST_INSTALL_FLAGS := --force-resolved-versions
else
TUIST_INSTALL_FLAGS :=
endif

.PHONY: tuist-install

tuist-install: $(TUIST_INSTALL_STAMP)

$(TUIST_INSTALL_STAMP): $(TUIST_INSTALL_INPUTS)
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
