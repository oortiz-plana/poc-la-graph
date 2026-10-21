# syntax=docker/dockerfile:1.7
FROM python:3.12-slim AS base

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    TIKTOKEN_CACHE_DIR=/opt/tiktoken-cache \
    VIRTUAL_ENV=/opt/venv
RUN python -m venv "$VIRTUAL_ENV"
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Mirrors the repository layout (apps/api inside /build) so tests that read
# repo-level files by relative path find them.
WORKDIR /build/apps/api
COPY apps/api/ ./
RUN pip install --upgrade pip && pip install . && \
    mkdir -p "$TIKTOKEN_CACHE_DIR" && \
    python -c 'import tiktoken; tiktoken.get_encoding("o200k_base")'

FROM base AS development
RUN pip install ".[dev]"
# Repo-level fixtures the API tests read: the sample legal corpus and the frozen contracts.
COPY knowledge/input /build/knowledge/input
COPY contracts /build/contracts

FROM development AS test
RUN pytest

FROM development AS lint
RUN ruff check . && ruff format --check . && mypy app

FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TIKTOKEN_CACHE_DIR=/opt/tiktoken-cache \
    PATH="/opt/venv/bin:$PATH"
RUN addgroup --system --gid 10001 app && \
    adduser --system --uid 10001 --ingroup app --home /app app
COPY --from=base /opt/venv /opt/venv
COPY --from=base /opt/tiktoken-cache /opt/tiktoken-cache
COPY --chown=app:app apps/api/app /app/app
COPY --chown=app:app apps/api/migrations /app/migrations
COPY --chown=app:app apps/api/alembic.ini /app/alembic.ini

WORKDIR /app
USER app
EXPOSE 8000
CMD ["/bin/sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers"]
