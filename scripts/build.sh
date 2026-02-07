#!/bin/bash
set -e

echo "🔨 Building slashbot for all platforms..."

# Create dist directory
mkdir -p dist

# Mark platform-specific native packages as external to avoid cross-platform resolution errors
EXTERNALS="--external '@opentui/core-*'"

# Build for all platforms in parallel
echo "Building Linux x64..."
bun build --compile --minify src/index.ts $EXTERNALS --target=bun-linux-x64 --outfile dist/slashbot-linux-x64 &

echo "Building Linux ARM64..."
bun build --compile --minify src/index.ts $EXTERNALS --target=bun-linux-arm64 --outfile dist/slashbot-linux-arm64 &

echo "Building Windows x64..."
bun build --compile --minify src/index.ts $EXTERNALS --target=bun-windows-x64 --outfile dist/slashbot-windows-x64.exe &

echo "Building macOS x64..."
bun build --compile --minify src/index.ts $EXTERNALS --target=bun-darwin-x64 --outfile dist/slashbot-macos-x64 &

echo "Building macOS ARM64..."
bun build --compile --minify src/index.ts $EXTERNALS --target=bun-darwin-arm64 --outfile dist/slashbot-macos-arm64 &

# Wait for all builds to complete
wait

echo ""
echo "✅ Build complete! Executables:"
ls -lh dist/
