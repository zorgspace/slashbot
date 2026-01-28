#!/bin/bash
set -e

# Determine repo from git origin
origin=$(git remote get-url origin 2>/dev/null)
if [[ -z "$origin" ]]; then
  echo "Error: No git origin found."
  exit 1
fi

if echo "$origin" | grep -q '^git@github\.com:'; then
  repo=$(echo "$origin" | sed 's/^git@github\.com\(:\/\)\?//; s/\.git$//')
elif echo "$origin" | grep -q '^https://github\.com/'; then
  repo=$(echo "$origin" | sed 's/^https:\/\/github\.com\///; s/\.git$//')
else
  echo "Error: Unsupported origin URL: $origin"
  exit 1
fi

echo "Repo: $repo"

# Get latest release tag (no jq needed)
tag=$(curl -s "https://api.github.com/repos/$repo/releases/latest" \
  | grep '"tag_name"' \
  | head -1 \
  | sed 's/.*": "\([^"]*\)".*/\1/')

if [[ -z "$tag" ]]; then
  echo "Error: No latest release found."
  exit 1
fi

echo "Latest tag: $tag"

# Detect platform and download matching binary
UNAME=$(uname -s | tr '[:upper:]' '[:lower:]')
case "${UNAME}" in
  linux)     os=linux ;;
  darwin)    os=macos ;;
  msys*|cygwin*|mingw*) os=windows; asset_ext=".exe" ;;
  *)         echo "Unsupported OS: ${UNAME}"; exit 1 ;;
esac

MACHINE=$(uname -m)
case "${MACHINE}" in
  x86_64*)   arch=x64 ;;
  arm64*|aarch64*) arch=arm64 ;;
  *)         echo "Unsupported arch: ${MACHINE}"; exit 1 ;;
esac

proj_name="${repo##*/}"
asset_name="slashbot-${os}-${arch}${asset_ext}"
filename="${proj_name}-${tag}-${os}-${arch}${asset_ext}"

url="https://github.com/${repo}/releases/download/${tag}/${asset_name}"

echo "Downloading ${asset_name}..."
if curl -L -o "${filename}" "${url}"; then
  if [[ "${asset_ext}" != ".exe" ]]; then
    chmod +x "${filename}"
  fi
  echo "Downloaded and made executable: ${filename} ($(du -h "${filename}" | cut -f1)) to $(pwd)"
else
  echo "Binary not available, fallback to source tar.gz"
  source_filename="${proj_name}-${tag}.tar.gz"
  source_url="https://github.com/${repo}/archive/refs/tags/${tag}.tar.gz"
  curl -L -o "${source_filename}" "${source_url}"
  echo "Downloaded source: ${source_filename} ($(du -h "${source_filename}" | cut -f1)) to $(pwd)"
fi