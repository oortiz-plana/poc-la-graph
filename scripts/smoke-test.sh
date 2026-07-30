#!/usr/bin/env sh
set -eu

api_url="${API_URL:-http://localhost:8000}"
web_url="${WEB_URL:-http://localhost:3000}"

curl --fail --silent --show-error "${api_url}/health" >/dev/null
curl --fail --silent --show-error "${api_url}/ready" >/dev/null
curl --fail --silent --show-error "${api_url}/docs" >/dev/null
curl --fail --silent --show-error "${web_url}" >/dev/null

printf '%s\n' "Smoke checks passed: ${web_url}, ${api_url}, ${api_url}/docs"
