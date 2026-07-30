# syntax=docker/dockerfile:1.7
FROM python:3.12-slim AS builder
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1 VIRTUAL_ENV=/opt/venv
RUN python -m venv "$VIRTUAL_ENV"
ENV PATH="$VIRTUAL_ENV/bin:$PATH"
COPY graphify/mock/requirements.txt /tmp/requirements.txt
RUN pip install --upgrade pip && pip install -r /tmp/requirements.txt

FROM python:3.12-slim AS runtime
ENV PATH="/opt/venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN addgroup --system --gid 10001 app && \
    adduser --system --uid 10001 --ingroup app --home /app app
COPY --from=builder /opt/venv /opt/venv
COPY --chown=app:app graphify/mock /app
COPY --chown=app:app graphify/sample /knowledge/sample-project
WORKDIR /app
USER app
EXPOSE 8001
CMD ["python", "server.py"]

