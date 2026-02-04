#!/bin/bash
set -e

echo "🔧 Slashbot Build Script"
echo "========================"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# Step 1: Install dependencies
echo -e "\n${GREEN}[1/3]${NC} Installing dependencies..."
bun install

# Step 2: Type check
echo -e "\n${GREEN}[2/3]${NC} Running type check..."
if bun run typecheck; then
    echo -e "${GREEN}✓${NC} Type check passed"
else
    echo -e "${RED}✗${NC} Type check failed"
    exit 1
fi

# Step 3: Build standalone binary
echo -e "\n${GREEN}[3/3]${NC} Compiling standalone binary..."
bun build --compile --minify src/index.ts --outfile dist/slashbot

echo -e "\n${GREEN}✓ Build complete!${NC}"
echo "  Binary: dist/slashbot"
