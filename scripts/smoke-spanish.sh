#!/usr/bin/env bash
set -euo pipefail

response_file="$(mktemp)"
trap 'rm -f "${response_file}"' EXIT

status="$(curl -fsS http://localhost:8000/api/v1/knowledge/graph)"
case "$status" in
  *'"status":"ready"'*) ;;
  *) echo "The real knowledge graph is not ready: $status" >&2; exit 1 ;;
esac

conversation="$(
  curl -fsS -X POST http://localhost:8000/api/v1/conversations \
    -H 'content-type: application/json' \
    -d '{"projectId":"sample-project"}'
)"
conversation_id="$(printf '%s' "$conversation" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
test -n "$conversation_id"
curl -fsS -N -X POST \
  "http://localhost:8000/api/v1/conversations/${conversation_id}/messages" \
  -H 'content-type: application/json' \
  -d '{"message":"¿Qué establece la Ley 100 de 1993 sobre el sistema general de pensiones?"}' \
  >"${response_file}"

python3 scripts/validate-spanish-smoke.py "${response_file}"
