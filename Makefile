# Makefile — NT4H Digital
# Monorepo pnpm+turbo: packages/{engine,catalog,schema,config} +
# apps/{mobile(Expo), backend(Django), engine-runner(Node)}.
# Requiere: pnpm 11+, python 3.11+, node, bash.
# Uso: make help

PNPM ?= pnpm
PY   ?= python

BACKEND := apps/backend
MOBILE  := apps/mobile
ENGINE  := packages/engine

.DEFAULT_GOAL := help
.PHONY: help setup \
        dev dev-web dev-backend dev-runner \
        build test lint typecheck test-all \
        test-engine test-mobile test-backend test-e2e \
        check-py lint-catalog lint-schema \
        complexity shots release clean

# ============================================================
#  HELP / SETUP
# ============================================================

help: ## Muestra esta ayuda
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sort | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

setup: ## pnpm install en todo el workspace + deps Python del backend
	$(PNPM) install
	cd $(BACKEND) && pip install -r requirements.txt

# ============================================================
#  DESARROLLO (turbo)
# ============================================================

dev: ## turbo dev de las apps frontales (excluye el backend Django)
	$(PNPM) dev

dev-web: ## Solo la app Expo web (:8081)
	cd $(MOBILE) && $(PNPM) web

dev-backend: ## Solo el backend Django
	cd $(BACKEND) && $(PY) manage.py runserver

dev-runner: ## Solo el engine-runner (Node, ejecuta el motor online)
	cd apps/engine-runner && $(PNPM) dev

# ============================================================
#  BUILD / TEST / LINT (turbo)
# ============================================================

build: ## turbo build (todos los paquetes)
	$(PNPM) build

test: ## turbo test (engine + mobile + runner)
	$(PNPM) test

lint: ## turbo lint (TS en todos los paquetes)
	$(PNPM) lint

typecheck: ## turbo typecheck
	$(PNPM) typecheck

test-all: ## Batería canónica completa (tools/test_all.sh)
	bash tools/test_all.sh

# ============================================================
#  TESTS POR PAQUETE
# ============================================================

test-engine: ## Tests del motor de reglas (vitest)
	cd $(ENGINE) && $(PNPM) test

test-mobile: ## Tests de la UI (vitest)
	cd $(MOBILE) && $(PNPM) test

test-backend: ## Tests Django del backend
	cd $(BACKEND) && $(PY) manage.py test

test-e2e: ## E2E Playwright de la app móvil
	cd $(MOBILE) && $(PNPM) test:e2e

# ============================================================
#  CALIDAD BACKEND (Python)
# ============================================================

check-py: ## Linters Python del backend (ruff+bandit+black+flake8+pydocstyle)
	cd $(BACKEND) && ruff check . && bandit -r . && \
	  black --check -l 120 . && flake8 . && \
	  pydocstyle --convention=google --add-ignore=D1 .

lint-catalog: ## ESLint del catálogo de cartas
	cd packages/catalog && $(PNPM) eslint src

lint-schema: ## ESLint de los schemas Zod
	cd packages/schema && $(PNPM) eslint src

# ============================================================
#  HERRAMIENTAS
# ============================================================

complexity: ## Informe LOC + densidad de decisiones (--fail para gate)
	$(PY) scripts/check-complexity.py

shots: ## Capturas de UI de los flujos de sala
	node tools/capture-screenshots.mjs

release: ## Release versionada — uso: make release VER=x.y.z
	pwsh tools/release.ps1 $(VER)

clean: ## Borra caches (node_modules se conserva; usa pnpm store si hace falta)
	find . -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null || true
	rm -rf .turbo */*/.turbo packages/*/.turbo apps/*/.turbo
