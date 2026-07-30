#!/usr/bin/env sh
set -eu

PYTHON_BIN="${PYTHON_BIN:-python3}"
GRAPHIFYY_VERSION="${GRAPHIFYY_VERSION:-0.9.18}"
MCP_VERSION="${MCP_VERSION:-1.29.0}"
INSPECT_DIR="${INSPECT_DIR:-/tmp/graphify-package-inspect}"

"$PYTHON_BIN" -m venv "$INSPECT_DIR"
"$INSPECT_DIR/bin/pip" install \
  "graphifyy[mcp]==$GRAPHIFYY_VERSION" \
  "mcp==$MCP_VERSION"

"$INSPECT_DIR/bin/python" -c "
import importlib.metadata as metadata

distribution = metadata.metadata('graphifyy')
print('graphifyy=' + metadata.version('graphifyy'))
print('mcp=' + metadata.version('mcp'))
print('requires-python=' + str(distribution.get('Requires-Python')))
for entry in metadata.entry_points(group='console_scripts'):
    if entry.dist and entry.dist.name == 'graphifyy':
        print(f'entry-point={entry.name}={entry.value}')
"

"$INSPECT_DIR/bin/graphify" --help
"$INSPECT_DIR/bin/python" -m graphify.serve --help
