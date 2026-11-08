.PHONY: setup dev up up-postgres down logs test test-api test-web lint e2e compose-check compose-check-postgres smoke clean knowledge-status knowledge-rollback test-integration test-graphify-real smoke-spanish neo4j-reload

setup:
	@test -f .env || cp .env.example .env
	docker compose build

dev up:
	docker compose up --build

up-postgres:
	docker compose -f docker-compose.yml -f compose/postgres.yml up --build

down:
	docker compose down --remove-orphans

logs:
	docker compose logs -f --tail=200

test: test-api test-web

test-api:
	docker build --target test -f docker/api.Dockerfile .

test-web:
	docker build --target test -f docker/web.Dockerfile .

lint:
	docker build --target lint -f docker/api.Dockerfile .
	docker build --target lint -f docker/web.Dockerfile .

# The stack has no Graphify runtime any more, so only the PL/SQL spec runs here.
e2e:
	PLSQL_ADAPTER=synthetic PLSQL_PROJECT_ID=sample PLSQL_SOURCE_ROOT=/app/plsql-fixtures/source \
	PLSQL_ENABLED=true LLM_ADAPTER=mock docker compose up -d --build
	cd tests/e2e && npm ci && npx playwright install --with-deps chromium && npm run test:plsql

compose-check:
	docker compose config --quiet

compose-check-postgres:
	docker compose -f docker-compose.yml -f compose/postgres.yml config --quiet

smoke:
	./scripts/smoke-test.sh

knowledge-status:
	docker compose run --rm --no-deps api python -m app.knowledge.cli status

knowledge-rollback:
	docker compose run --rm --no-deps api python -m app.knowledge.cli rollback

test-integration:
	docker build --target test -f docker/api.Dockerfile .

test-graphify-real:
	bash scripts/test-real-graphify.sh

smoke-spanish:
	bash scripts/smoke-spanish.sh

clean:
	docker compose down --remove-orphans --volumes

# Replace the Neo4j graph with neo4j/dump/neo4j.dump (override NEO4J_COMPOSE for another stack).
NEO4J_COMPOSE ?= docker-compose.yml
neo4j-reload:
	docker compose -f $(NEO4J_COMPOSE) stop neo4j
	NEO4J_DUMP_FORCE=true docker compose -f $(NEO4J_COMPOSE) run --rm neo4j-init
	docker compose -f $(NEO4J_COMPOSE) up -d neo4j
