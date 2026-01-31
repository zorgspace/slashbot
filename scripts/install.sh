#/usr/bin/env bash
set -euo pipefail

# Edit these to match your GitHub repo for "computer"
REPO_OWNER="slashdot-ai"  # Change to your GitHub username/org
REPO_NAME="computer"      # Repo name
BIN_NAME="computer"       # Binary name after install

VERSION="${1:-latest}"
INSTALL_DIR="${2:-/usr/local/bin}"

if [[ "$VERSION" == "latest" ]]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest" | grep '"tag_name"' | head -1 | cut -d '"' -f4)
fi

echo "Fetching release v${VERSION}..."

OS=$(uname | tr '[:upper:]' '[:lower:]')
case "$OS" in
  linux*) OS="linux" ;;
  darwin*) OS="darwin" ;;
esac

ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64) ARCH="amd64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

ASSET_NAME="${BIN_NAME}-${OS}-${ARCH}"
DOWNLOAD_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${VERSION}/${ASSET_NAME}"

echo "Downloading ${ASSET_NAME}..."
TEMP_FILE=$(mktemp)
curl -fsSL "$DOWNLOAD_URL" -o "$TEMP_FILE"

chmod +x "$TEMP_FILE"

if [[ ! -w "$INSTALL_DIR" ]]; then
  echo "Using sudo to install to $INSTALL_DIR..."
  sudo mv "$TEMP_FILE" "${INSTALL_DIR}/${BIN_NAME}"
else
  mv "$TEMP_FILE" "${INSTALL_DIR}/${BIN_NAME}"
fi

echo "${BIN_NAME} v${VERSION} installed to ${INSTALL_DIR}/${BIN_NAME}"
echo "Add ${INSTALL_DIR} to PATH if needed: export PATH=\"\$PATH:${INSTALL_DIR}\""