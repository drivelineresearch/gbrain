SHELL := /bin/bash
.DEFAULT_GOAL := help

RELEASE_ROOT ?= /home/andrew/.local/lib/gbrain/releases
ACTIVE_LINK ?= /home/andrew/.local/bin/gbrain-production
ROLLBACK_STATE ?= /home/andrew/.local/state/dbrain/previous-gbrain-release
GBRAIN_HEALTH_URL ?= http://127.0.0.1:4242/health
RELEASE_ID := $(shell git rev-parse HEAD)
RELEASE_BINARY := $(RELEASE_ROOT)/$(RELEASE_ID)/gbrain

.PHONY: help sync verify ci build stage activate receipt deploy rollback

help:
	@printf '%s\n' \
	  'make sync      Install the exact dependency graph without lifecycle scripts' \
	  'make verify    Run the authoritative fast pre-push gate' \
	  'make ci        Run the full local Docker-backed CI gate' \
	  'make build     Compile the self-contained GBrain executable' \
	  'make stage     Verify and install the exact commit as an immutable release' \
	  'make activate  Atomically point the production executable at that release' \
	  'make receipt   Verify local health and GBrain doctor after activation' \
	  'make deploy    Stage, activate, apply migrations explicitly, restart, and verify' \
	  'make rollback  Restore the exact executable target recorded before activation'

sync:
	bun install --frozen-lockfile --ignore-scripts

verify: sync
	bun run verify

ci: sync
	bun run ci:local

build:
	bun run build
	./bin/gbrain --version

stage: verify build
	@git diff --quiet && git diff --cached --quiet || { \
	  echo 'refusing to stage a release from a tracked-dirty checkout' >&2; exit 1; \
	}
	install -d -m 0755 "$(RELEASE_ROOT)/$(RELEASE_ID)"
	install -m 0755 bin/gbrain "$(RELEASE_BINARY)"
	"$(RELEASE_BINARY)" --version

activate: stage
	@install -d -m 0755 "$$(dirname "$(ACTIVE_LINK)")"
	@install -d -m 0700 "$$(dirname "$(ROLLBACK_STATE)")"
	@previous=$$(readlink "$(ACTIVE_LINK)" 2>/dev/null || true); \
	if [[ -z "$$previous" ]]; then previous=/home/andrew/.bun/bin/gbrain; fi; \
	if [[ "$$previous" != "$(RELEASE_BINARY)" ]]; then \
	  printf '%s\n' "$$previous" >"$(ROLLBACK_STATE)"; \
	  chmod 0600 "$(ROLLBACK_STATE)"; \
	fi
	@tmp="$(ACTIVE_LINK).tmp.$$$$"; \
	trap 'rm -f -- "$$tmp"' EXIT; \
	ln -s "$(RELEASE_BINARY)" "$$tmp"; \
	mv -Tf "$$tmp" "$(ACTIVE_LINK)"

receipt:
	curl --fail --silent --show-error "$(GBRAIN_HEALTH_URL)" | jq -e \
	  '.status == "ok" or .status == "healthy"' >/dev/null
	"$(ACTIVE_LINK)" doctor --json | jq -e \
	  '.schema_version == 2 and .status != "unhealthy" and .brain_checks_score >= 80 and .category_scores.skill >= 90 and .category_scores.ops >= 90 and .category_scores.meta >= 90 and ([.checks[] | select(.status == "error" or .status == "fail" or .status == "critical")] | length == 0)' \
	  >/dev/null

deploy: activate
	"$(ACTIVE_LINK)" apply-migrations --yes --non-interactive
	sudo systemctl restart gbrain.service
	$(MAKE) receipt

rollback:
	@test -s "$(ROLLBACK_STATE)" || { echo 'no recorded GBrain release to restore' >&2; exit 1; }
	@previous=$$(<"$(ROLLBACK_STATE)"); \
	case "$$previous" in \
	  /home/andrew/.local/lib/gbrain/releases/*/gbrain|/home/andrew/.bun/bin/gbrain) ;; \
	  *) echo "refusing unexpected rollback target: $$previous" >&2; exit 1 ;; \
	esac; \
	test -x "$$previous"; \
	tmp="$(ACTIVE_LINK).tmp.$$$$"; \
	trap 'rm -f -- "$$tmp"' EXIT; \
	ln -s "$$previous" "$$tmp"; \
	mv -Tf "$$tmp" "$(ACTIVE_LINK)"
	sudo systemctl restart gbrain.service
	$(MAKE) receipt
