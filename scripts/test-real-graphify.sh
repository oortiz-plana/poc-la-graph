#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
server_name="graphify-real-contract-${$}"
graphify_image="graphify-agent-poc:graphify-contract"
api_image="graphify-agent-poc:api-contract"

cleanup() {
  docker rm --force "${server_name}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

cd "${repo_root}"
docker build --file docker/graphify.Dockerfile --tag "${graphify_image}" .
docker build --file docker/api.Dockerfile --target runtime --tag "${api_image}" .

docker run --detach --rm \
  --name "${server_name}" \
  --publish 127.0.0.1:18001:8001 \
  --env GRAPHIFY_GRAPH_PATH=/fixture/minimal-graph.json \
  --volume "${repo_root}/tests/fixtures/graphify-real/minimal-graph.json:/fixture/minimal-graph.json:ro" \
  "${graphify_image}" >/dev/null

ready=0
for _attempt in $(seq 1 30); do
  if curl --silent --output /dev/null http://127.0.0.1:18001/mcp; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "${ready}" -ne 1 ]]; then
  docker logs "${server_name}" >&2
  echo "Graphify contract server did not become healthy" >&2
  exit 1
fi

docker run --rm --network host \
  --volume "${repo_root}/scripts/test-real-graphify-client.py:/contract.py:ro" \
  "${api_image}" python /contract.py

echo "Real Graphify 0.9.18 MCP adapter contract passed."
