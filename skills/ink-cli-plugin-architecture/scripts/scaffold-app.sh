#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scaffold-app.sh <target-project-root>

Copy the plugin-ready Ink template into a target project directory.
Fails if target directory already contains files.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

target_root="$1"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skill_dir="$(cd "$script_dir/.." && pwd)"
template_dir="$skill_dir/assets/plugin-ready-template"

if [[ ! -d "$template_dir" ]]; then
  echo "Error: template directory not found at $template_dir" >&2
  exit 1
fi

mkdir -p "$target_root"
if [[ -n "$(ls -A "$target_root")" ]]; then
  echo "Error: target directory is not empty: $target_root" >&2
  exit 1
fi

cp -R "$template_dir"/. "$target_root"/
echo "Created Ink plugin-ready app at: $target_root"
