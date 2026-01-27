#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

echo -e "${YELLOW}🚀 Deploying slashbot $TAG${NC}"
echo ""

# Check if dist directory exists and has files
if [ ! -d "dist" ] || [ -z "$(ls -A dist 2>/dev/null)" ]; then
    echo -e "${RED}❌ No build artifacts found. Run ./scripts/build.sh first${NC}"
    exit 1
fi

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${YELLOW}⚠️  Warning: You have uncommitted changes${NC}"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check if tag already exists
if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo -e "${RED}❌ Tag $TAG already exists. Bump version in package.json first${NC}"
    exit 1
fi

# Confirm deployment
echo "This will:"
echo "  1. Create git tag $TAG"
echo "  2. Push tag to origin"
echo "  3. Publish to npm"
echo ""
read -p "Proceed? (y/N) " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# Create and push git tag
echo -e "${GREEN}📌 Creating tag $TAG...${NC}"
git tag -a "$TAG" -m "Release $TAG"
git push origin "$TAG"

# Publish to npm
echo -e "${GREEN}📦 Publishing to npm...${NC}"
npm publish

echo ""
echo -e "${GREEN}✅ Successfully deployed slashbot $TAG${NC}"
echo ""
echo "Next steps:"
echo "  - Create GitHub release: https://github.com/YOUR_USERNAME/slashbot/releases/new?tag=$TAG"
echo "  - Upload binaries from dist/ to the release"
