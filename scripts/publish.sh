#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI_DIR="$ROOT/packages/cli"
PLUGIN_DIR="$ROOT/packages/opencode-plugin"
DRY_RUN=false
TAG=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Publish rehydra SDK, @rehydra/cli, and @rehydra/opencode to npm.

Options:
  --dry-run     Run npm publish with --dry-run (no actual publish)
  --tag <tag>   Publish with a dist-tag (e.g. beta, next)
  -h, --help    Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)  DRY_RUN=true; shift ;;
    --tag)      TAG="$2"; shift 2 ;;
    -h|--help)  usage; exit 0 ;;
    *)          echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

PUBLISH_FLAGS=()
if [[ "$DRY_RUN" == true ]]; then
  PUBLISH_FLAGS+=(--dry-run)
fi
if [[ -n "$TAG" ]]; then
  PUBLISH_FLAGS+=(--tag "$TAG")
fi

# Read versions
SDK_VERSION=$(node -p "require('$ROOT/package.json').version")
CLI_VERSION=$(node -p "require('$CLI_DIR/package.json').version")
PLUGIN_VERSION=$(node -p "require('$PLUGIN_DIR/package.json').version")

echo "==> Versions: rehydra@$SDK_VERSION, @rehydra/cli@$CLI_VERSION, @rehydra/opencode@$PLUGIN_VERSION"

if [[ "$SDK_VERSION" != "$CLI_VERSION" || "$SDK_VERSION" != "$PLUGIN_VERSION" ]]; then
  echo "ERROR: Version mismatch — SDK is $SDK_VERSION, CLI is $CLI_VERSION, plugin is $PLUGIN_VERSION"
  echo "All packages must have the same version."
  exit 1
fi

# Build
echo "==> Building..."
cd "$ROOT"
npm run clean
npm run build

# Lint & test
echo "==> Running lint..."
npm run lint

echo "==> Running tests..."
npx vitest run

# Publish SDK
echo "==> Publishing rehydra@$SDK_VERSION..."
cd "$ROOT"
npm publish "${PUBLISH_FLAGS[@]}"

# Sync CLI dependency version to the just-published SDK version
echo "==> Syncing @rehydra/cli dependency to rehydra@^$SDK_VERSION..."
cd "$CLI_DIR"
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.dependencies.rehydra = '^$SDK_VERSION';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# Publish CLI
echo "==> Publishing @rehydra/cli@$CLI_VERSION..."
npm publish --access public "${PUBLISH_FLAGS[@]}"

# Sync plugin dependency version to the just-published SDK version
echo "==> Syncing @rehydra/opencode dependency to rehydra@^$SDK_VERSION..."
cd "$PLUGIN_DIR"
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.dependencies.rehydra = '^$SDK_VERSION';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# Publish plugin
echo "==> Publishing @rehydra/opencode@$PLUGIN_VERSION..."
npm publish --access public "${PUBLISH_FLAGS[@]}"

echo ""
echo "==> Done! Published:"
echo "    rehydra@$SDK_VERSION"
echo "    @rehydra/cli@$CLI_VERSION"
echo "    @rehydra/opencode@$PLUGIN_VERSION"
