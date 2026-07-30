.PHONY: setup dev up up-postgres down logs test test-api test-web lint e2e compose-check compose-check-postgres smoke clean knowledge-ingest knowledge-status knowledge-rebuild knowledge-rollback test-integration test-graphify-real smoke-spanish

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

e2e:
	docker compose -f docker-compose.yml -f docker-compose.synthetic.yml up -d --build
	cd tests/e2e && npm ci && npx playwright install --with-deps chromium && npm test

compose-check:
	docker compose config --quiet

compose-check-postgres:
	docker compose -f docker-compose.yml -f compose/postgres.yml config --quiet

smoke:
	./scripts/smoke-test.sh

knowledge-ingest:
	docker compose run --rm knowledge-ingest python -m app.knowledge.cli ingest

knowledge-rebuild:
	docker compose run --rm knowledge-ingest python -m app.knowledge.cli ingest --force

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
