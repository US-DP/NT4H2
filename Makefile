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
        check-py check-py-extra lint-catalog lint-schema lint-yaml \
        audit audit-catalog verify-cards gen-traceability promote-verified \
        loadtest docker-runner \
        complexity shots release hooks clean

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

check-py-extra: ## Linters profundos del backend (pylint+deptry+vulture+radon+pyright)
	cd $(BACKEND) && DJANGO_DEBUG=true pylint backend game && \
	  deptry . && vulture . && \
	  radon cc -s -a backend game --exclude "migrations,tests.py" && \
	  radon mi -s game/views && npx pyright

lint-catalog: ## ESLint del catálogo de cartas
	cd packages/catalog && $(PNPM) eslint src

lint-schema: ## ESLint de los schemas Zod
	cd packages/schema && $(PNPM) eslint src

lint-yaml: ## yamllint del repo + actionlint de los workflows
	yamllint . && actionlint .github/workflows/*.yml

# ============================================================
#  SEGURIDAD / DATOS
# ============================================================

audit: ## Auditoría de dependencias (pnpm --prod + pip-audit, como security.yml)
	$(PNPM) audit --prod --audit-level=high
	cd $(BACKEND) && $(PY) -m pip_audit -r requirements.txt

audit-catalog: ## Auditoría del catálogo contra el inventario oficial
	$(PY) scripts/audit_catalog.py

verify-cards: ## Verificación OCR de las cartas escaneadas
	$(PY) scripts/verify_cards_ocr.py

gen-traceability: ## Genera la matriz de trazabilidad requisitos↔tests
	$(PY) scripts/gen_traceability.py

promote-verified: ## Promociona cartas verificadas al catálogo
	$(PY) scripts/promote_verified.py

loadtest: ## Load test del WebSocket del runner — uso: make loadtest ARGS="--rooms 10"
	node scripts/loadtest_ws.mjs $(ARGS)

docker-runner: ## Build de la imagen Docker del engine-runner — uso: make docker-runner TAG=dev
	docker build -f apps/engine-runner/Dockerfile -t nt4h-engine-runner:$(or $(TAG),dev) .

# ============================================================
#  HERRAMIENTAS
# ============================================================

complexity: ## Informe LOC + densidad de decisiones (--fail para gate)
	$(PY) scripts/check-complexity.py

shots: ## Capturas de UI de los flujos de sala
	node tools/capture-screenshots.mjs

release: ## Release versionada — uso: make release VER=x.y.z
	pwsh tools/release.ps1 $(VER)

hooks: ## Activa los git hooks del repo (core.hooksPath=.githooks)
	git config core.hooksPath .githooks

clean: ## Borra caches (node_modules se conserva; usa pnpm store si hace falta)
	find . -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null || true
	rm -rf .turbo */*/.turbo packages/*/.turbo apps/*/.turbo
