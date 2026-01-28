#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Slashbot Release & Deploy${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check requirements
command -v bun >/dev/null 2>&1 || { echo -e "${RED}❌ bun is required${NC}"; exit 1; }
command -v gh >/dev/null 2>&1 || { echo -e "${RED}❌ gh (GitHub CLI) is required. Install: https://cli.github.com/${NC}"; exit 1; }

# Get current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "Current version: ${YELLOW}${CURRENT_VERSION}${NC}"

# Ask for new version or use current
read -p "New version (Enter to keep $CURRENT_VERSION): " NEW_VERSION
VERSION=${NEW_VERSION:-$CURRENT_VERSION}

# Update package.json if version changed
if [ "$VERSION" != "$CURRENT_VERSION" ]; then
    echo -e "${GREEN}Updating version to $VERSION...${NC}"
    sed -i "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$VERSION\"/" package.json
fi

TAG="$VERSION"

echo ""
echo -e "Version: ${GREEN}${VERSION}${NC}"
echo -e "Tag:     ${GREEN}${TAG}${NC}"
echo ""

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${YELLOW}⚠️  Uncommitted changes detected${NC}"
    git status --short
    echo ""
    read -p "Commit changes? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "Commit message: " COMMIT_MSG
        git add -A
        git commit -m "${COMMIT_MSG:-chore(release): bump version to $VERSION}"
        git push
    else
        echo -e "${RED}Please commit changes first${NC}"
        exit 1
    fi
fi

# Check if tag already exists
if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo -e "${RED}❌ Tag $TAG already exists${NC}"
    read -p "Delete and recreate? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git tag -d "$TAG"
        git push origin --delete "$TAG" 2>/dev/null || true
    else
        exit 1
    fi
fi

# Build
echo ""
echo -e "${GREEN}📦 Building...${NC}"
mkdir -p dist
bun build --compile --minify src/index.ts --outfile dist/slashbot

# Get binary size
BINARY_SIZE=$(du -h dist/slashbot | cut -f1)
echo -e "${GREEN}✓ Built dist/slashbot (${BINARY_SIZE})${NC}"

# Create tag
echo ""
echo -e "${GREEN}🏷️  Creating tag $TAG...${NC}"
git tag "$TAG"
git push origin "$TAG"

# Generate release notes
echo ""
echo -e "${GREEN}📝 Generating release notes...${NC}"

PREV_TAG=$(git describe --tags --abbrev=0 "$TAG^" 2>/dev/null || echo "")
if [ -n "$PREV_TAG" ]; then
    COMMITS=$(git log --oneline "$PREV_TAG..$TAG" | head -20)
else
    COMMITS=$(git log --oneline -10)
fi

RELEASE_NOTES="## What's Changed

$COMMITS

## Installation

\`\`\`bash
# Download and install
curl -fsSL https://github.com/zorgspace/slashbot/releases/download/$TAG/slashbot -o /usr/local/bin/slashbot
chmod +x /usr/local/bin/slashbot
\`\`\`

## Binary

- \`slashbot\` - Linux x64 binary ($BINARY_SIZE)
"

# Create GitHub release
echo ""
echo -e "${GREEN}🚀 Creating GitHub release...${NC}"
gh release create "$TAG" \
    --title "Slashbot $TAG" \
    --notes "$RELEASE_NOTES" \
    dist/slashbot

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Successfully released Slashbot $TAG${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "Release URL: ${CYAN}https://github.com/zorgspace/slashbot/releases/tag/$TAG${NC}"
echo ""
