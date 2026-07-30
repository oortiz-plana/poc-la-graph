# syntax=docker/dockerfile:1.7
FROM python:3.12-slim

ARG GRAPHIFY_PACKAGE_VERSION=0.9.18
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN python -m pip install --upgrade pip && \
    python -m pip install "graphifyy[mcp]==${GRAPHIFY_PACKAGE_VERSION}" "mcp==1.29.0" && \
    addgroup --system --gid 10001 graphify && \
    adduser --system --uid 10001 --ingroup graphify --home /home/graphify graphify

COPY --chown=graphify:graphify scripts/graphify/runtime.py /opt/graphify/runtime.py
COPY --chown=graphify:graphify scripts/graphify/healthcheck.py /opt/graphify/healthcheck.py

USER graphify
WORKDIR /knowledge
EXPOSE 8001
ENTRYPOINT ["python", "/opt/graphify/runtime.py"]
