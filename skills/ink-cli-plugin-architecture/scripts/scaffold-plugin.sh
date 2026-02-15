#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scaffold-plugin.sh <target-project-root> <plugin-id>

Create a plugin scaffold at:
  <target-project-root>/src/plugins/<plugin-id>/index.ts

Constraints:
  - plugin-id must match: [a-z][a-z0-9-]*
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -ne 2 ]]; then
  usage
  exit 1
fi

project_root="$1"
plugin_id="$2"

if [[ ! "$plugin_id" =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo "Error: invalid plugin-id '$plugin_id'" >&2
  exit 1
fi

plugin_dir="$project_root/src/plugins/$plugin_id"
plugin_file="$plugin_dir/index.ts"
mkdir -p "$plugin_dir"

if [[ -e "$plugin_file" ]]; then
  echo "Error: plugin file already exists at $plugin_file" >&2
  exit 1
fi

cat > "$plugin_file" <<EOF2
import type { InkPlugin } from '../../core/contracts.js';

export const ${plugin_id//-/_}Plugin: InkPlugin = {
  id: '${plugin_id}',
  setup(api) {
    api.registerCommand({
      id: '${plugin_id}:run',
      description: 'Run ${plugin_id} command',
      async run() {
        return 'Plugin ${plugin_id} is wired and ready.';
      },
    });
  },
};
EOF2

echo "Created: $plugin_file"
echo "Next: register this plugin in src/plugins/index.ts"
